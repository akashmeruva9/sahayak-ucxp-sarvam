import { create } from "zustand";
import type { BusinessId, Conversation, Message } from "@/types";
import { deriveTitle, sendChat } from "@/api/chat";
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

    const userMsg: Message = {
      id: uid("msg"),
      role: "user",
      text: trimmed,
      createdAt: Date.now(),
      status: "sent",
    };
    const pendingId = uid("msg");
    const pendingMsg: Message = {
      id: pendingId,
      role: "assistant",
      text: "",
      createdAt: Date.now(),
      pending: true,
    };

    // Optimistic update: user turn + typing bubble.
    set((s) => ({
      conversations: s.conversations.map((c) =>
        c.id === conversationId
          ? {
              ...c,
              title: c.messages.length === 0 ? deriveTitle(trimmed) : c.title,
              businessId: c.businessId ?? businessId,
              updatedAt: Date.now(),
              messages: [...c.messages, userMsg, pendingMsg],
            }
          : c
      ),
    }));

    const applyAssistant = (patch: Partial<Message>) =>
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
}));
