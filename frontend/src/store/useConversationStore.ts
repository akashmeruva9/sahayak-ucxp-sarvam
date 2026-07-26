import { create } from "zustand";
import type { BusinessId, Conversation, Message } from "@/types";
import { deriveTitle, sendChat } from "@/api/chat";
import { getBusiness } from "@/constants/businesses";
import { uid } from "@/utils/id";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** Seed conversations so History + Home feel populated on first launch. */
function seedConversations(): Conversation[] {
  const now = Date.now();
  const make = (
    id: string,
    businessId: BusinessId,
    title: string,
    userText: string,
    assistantText: string,
    action: Message["action"],
    updatedAt: number
  ): Conversation => ({
    id,
    title,
    businessId,
    createdAt: updatedAt - 4 * 60000,
    updatedAt,
    messages: [
      { id: uid("msg"), role: "user", text: userText, createdAt: updatedAt - 4 * 60000, status: "sent" },
      {
        id: uid("msg"),
        role: "assistant",
        text: assistantText,
        createdAt: updatedAt - 3 * 60000,
        status: "sent",
        businessId,
        action,
      },
    ],
  });

  return [
    make(
      "seed-flipkart",
      "flipkart",
      "Track my Flipkart order",
      "Where is my Flipkart order?",
      "Your package has left the Bengaluru hub and is out for delivery.",
      { label: "Order arriving tomorrow", tone: "success" },
      now - 2 * HOUR
    ),
    make(
      "seed-swiggy",
      "swiggy",
      "Swiggy order status",
      "What's the status of my Swiggy order?",
      "Your order from Meghana Foods is being prepared and will be picked up shortly.",
      { label: "Arriving in ~35 min", tone: "success" },
      now - 5 * HOUR
    ),
    make(
      "seed-airtel",
      "airtel",
      "Cancel Airtel Fiber",
      "I want to cancel my Airtel Fiber connection",
      "I've raised a cancellation request. Pickup will be scheduled within 48 hours.",
      { label: "Cancellation submitted", tone: "warning" },
      now - DAY - 3 * HOUR
    ),
    make(
      "seed-hdfc",
      "hdfc",
      "Raise a bank complaint",
      "There's a wrong charge on my HDFC card",
      "Your complaint has been logged. Resolution is expected within 3 working days.",
      { label: "Complaint #HDFC-48213 opened", tone: "info" },
      now - 3 * DAY
    ),
    make(
      "seed-apollo",
      "apollo",
      "Book Apollo appointment",
      "Book me a doctor's appointment at Apollo",
      "Dr. Meera Rao has an opening tomorrow at 11:30 AM at Apollo Clinic, Indiranagar.",
      { label: "Slot held for 10 minutes", tone: "info" },
      now - 6 * DAY
    ),
  ];
}

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
  conversations: seedConversations(),
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
        businessId: businessId ?? conv?.businessId,
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
