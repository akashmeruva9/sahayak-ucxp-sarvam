import { create } from "zustand";
import type { BusinessId, Conversation, Message } from "@/types";
import { deriveTitle, sendChat } from "@/api/chat";
import { fileKind, sendDocument as postDocument, type PickedFile } from "@/api/documents";
import { getBusiness } from "@/constants/businesses";
import { uid } from "@/utils/id";

interface ConversationState {
  conversations: Conversation[];
  activeId: string | null;
  selectedBusinessId?: BusinessId;

  getConversation: (id: string) => Conversation | undefined;
  createConversation: (businessId?: BusinessId) => string;
  /** Open a fresh support chat scoped to a business, seeded with a greeting. */
  startBusinessChat: (businessId: BusinessId) => string;
  setActive: (id: string | null) => void;
  setSelectedBusiness: (id?: BusinessId) => void;
  /** Optimistically append the user turn + a pending assistant turn, then resolve via the API. */
  sendMessage: (conversationId: string, text: string, businessId?: BusinessId) => Promise<void>;
  /**
   * Same turn shape as `sendMessage`, but the user's half is an uploaded file.
   * The runtime reads it and resolves a capability from what it finds.
   */
  sendDocument: (
    conversationId: string,
    file: PickedFile,
    caption?: string,
    businessId?: BusinessId
  ) => Promise<void>;
}

type SetState = (partial: (state: ConversationState) => Partial<ConversationState>) => void;

/**
 * Append the customer's turn plus a typing bubble, and return the patcher that
 * resolves that bubble once the runtime answers.
 *
 * Shared by the text and document paths so both behave identically — same
 * optimistic append, same title derivation, same failure shape. They diverge
 * only in what they send.
 */
function beginTurn(
  set: SetState,
  conversationId: string,
  userMsg: Message,
  businessId?: BusinessId
): (patch: Partial<Message>) => void {
  const pendingId = uid("msg");
  const pendingMsg: Message = {
    id: pendingId,
    role: "assistant",
    text: "",
    createdAt: Date.now(),
    pending: true,
  };

  set((s) => ({
    conversations: s.conversations.map((c) =>
      c.id === conversationId
        ? {
            ...c,
            // An upload with no caption has no text to title the chat with, so
            // fall back to the filename.
            title:
              c.messages.length === 0
                ? deriveTitle(userMsg.text || userMsg.attachment?.name || "Document")
                : c.title,
            businessId: c.businessId ?? businessId,
            updatedAt: Date.now(),
            messages: [...c.messages, userMsg, pendingMsg],
          }
        : c
    ),
  }));

  return (patch: Partial<Message>) =>
    set((s) => ({
      conversations: s.conversations.map((c) =>
        c.id === conversationId
          ? {
              ...c,
              updatedAt: Date.now(),
              businessId: c.businessId ?? patch.businessId ?? businessId,
              messages: c.messages.map((m) =>
                m.id === pendingId ? { ...m, ...patch, pending: false } : m
              ),
            }
          : c
      ),
    }));
}

export const useConversationStore = create<ConversationState>((set, get) => ({
  conversations: [],
  activeId: null,
  selectedBusinessId: undefined,

  getConversation: (id) => get().conversations.find((c) => c.id === id),

  createConversation: (businessId) => {
    const id = uid("conv");
    const now = Date.now();
    const conversation: Conversation = {
      id,
      title: "New conversation",
      businessId,
      scoped: Boolean(businessId && businessId !== "generic"),
      createdAt: now,
      updatedAt: now,
      messages: [],
    };
    set((s) => ({ conversations: [conversation, ...s.conversations], activeId: id }));
    return id;
  },

  startBusinessChat: (businessId) => {
    const id = uid("conv");
    const now = Date.now();
    const business = getBusiness(businessId);
    const greeting: Message = {
      id: uid("msg"),
      role: "assistant",
      text: `Hi! You're connected to ${business.name} support over UCXP. How can I help you today?`,
      createdAt: now,
      status: "sent",
      businessId,
    };
    const conversation: Conversation = {
      id,
      title: `${business.name} support`,
      businessId,
      scoped: true,
      createdAt: now,
      updatedAt: now,
      messages: [greeting],
    };
    set((s) => ({ conversations: [conversation, ...s.conversations], activeId: id }));
    return id;
  },

  setActive: (id) => set({ activeId: id }),
  setSelectedBusiness: (id) => set({ selectedBusinessId: id }),

  sendMessage: async (conversationId, text, businessId) => {
    const trimmed = text.trim();
    if (!trimmed) return;

    const applyAssistant = beginTurn(
      set,
      conversationId,
      { id: uid("msg"), role: "user", text: trimmed, createdAt: Date.now(), status: "sent" },
      businessId
    );

    try {
      const conv = get().getConversation(conversationId);
      const { message } = await sendChat({
        text: trimmed,
        history: conv?.messages,
        // Pin only a scoped chat. A general chat acquires `businessId` once the
        // runtime resolves one, but must stay switchable, so it is not sent.
        businessId: conv?.scoped ? businessId ?? conv?.businessId : undefined,
        // Server-side memory is keyed on this — it's what lets "Cancel it."
        // resolve the business and the order without repeating them.
        conversationId,
      });
      applyAssistant({
        text: message.text,
        status: "sent",
        businessId: message.businessId,
        action: message.action,
      });
    } catch {
      applyAssistant({
        text: "Something went wrong reaching that business. Please try again.",
        status: "error",
      });
    }
  },

  sendDocument: async (conversationId, file, caption, businessId) => {
    const trimmed = (caption ?? "").trim();

    // The user's bubble shows the filename and their caption — never the
    // extracted text, which is long, noisy, and not something they wrote.
    const applyAssistant = beginTurn(
      set,
      conversationId,
      {
        id: uid("msg"),
        role: "user",
        text: trimmed,
        createdAt: Date.now(),
        status: "sent",
        attachment: { name: file.name, kind: fileKind(file) },
      },
      businessId
    );

    try {
      const conv = get().getConversation(conversationId);
      const { message } = await postDocument({
        file,
        caption: trimmed,
        businessId: conv?.scoped ? businessId ?? conv?.businessId : undefined,
        conversationId,
      });
      applyAssistant({
        text: message.text,
        status: message.status,
        businessId: message.businessId,
        action: message.action,
      });
    } catch (err) {
      // A rejected file (too large, unreadable) has a message worth showing —
      // it tells the customer what to do differently.
      applyAssistant({
        text:
          err instanceof Error && err.message
            ? err.message
            : "I couldn't read that file. Please try another, or type the details.",
        status: "error",
      });
    }
  },
}));
