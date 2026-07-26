import type { BusinessAction, BusinessId, Message } from "@/types";
import { uid } from "@/utils/id";
import { isMockMode, postJson } from "./client";

export interface ChatRequest {
  text: string;
  /** Prior turns (unused by the live runtime, which holds memory server-side). */
  history?: Message[];
  businessId?: BusinessId;
  /**
   * Runtime conversation id. Memory lives server-side, so without this every
   * turn starts fresh and "Cancel it." can't resolve.
   */
  conversationId?: string;
}

export interface ChatResponse {
  message: Message;
}

function buildMessage(
  businessId: BusinessId | undefined,
  text: string,
  action?: BusinessAction
): ChatResponse {
  return {
    message: {
      id: uid("msg"),
      role: "assistant",
      text,
      createdAt: Date.now(),
      status: "sent",
      businessId,
      action,
    },
  };
}

/** The UCXP Runtime's POST /chat response — PLAN.md §6. */
interface RuntimeChatResponse {
  success?: boolean;
  conversation_id: string;
  reply_text: string;
  business_id?: string | null;
  capability?: string | null;
  receipt?: { label: string; tone?: "info" | "success" | "warning" } | null;
  needs?: { input: string; prompt: string } | null;
  state: string;
  language: string;
  degraded?: string[];
}

/**
 * The UCXP Runtime.
 *
 * It detects the language, routes to a business via its manifest, executes a
 * real capability and returns a receipt — the outcomes actually happened.
 * Business routing and memory are server-side; the client just carries the
 * conversation id (and an optional business hint for a scoped support chat).
 */
async function sendChatLive(req: ChatRequest): Promise<ChatResponse> {
  // A multilingual turn is translate-in → classify → act → compose →
  // translate-out, several sarvam-105b calls; ~50 s is normal. Give it headroom
  // so a slow-but-successful turn isn't shown to the user as a failure.
  const CHAT_TIMEOUT_MS = 120_000;
  const data = await postJson<RuntimeChatResponse>("/chat", {
    text: req.text,
    conversation_id: req.conversationId,
    // Pin the runtime to the scoped business (a chat opened from the directory)
    // so order lookups hit the right store — the app's equivalent of the
    // WhatsApp business line. Omitted for unscoped Home chats.
    business_id: req.businessId && req.businessId !== "generic" ? req.businessId : undefined,
  }, CHAT_TIMEOUT_MS);

  const action: BusinessAction | undefined = data.receipt
    ? { label: data.receipt.label, tone: data.receipt.tone ?? "info" }
    : undefined;

  // Trust the runtime's manifest-driven routing; keep the caller's hint (a
  // scoped support chat) until the runtime resolves a business itself.
  const businessId = (data.business_id as BusinessId | undefined) ?? req.businessId;

  return buildMessage(businessId, data.reply_text, action);
}

/** POST /chat — returns a single assistant message from the UCXP Runtime. */
export async function sendChat(req: ChatRequest): Promise<ChatResponse> {
  if (isMockMode()) {
    // No backend configured. There is no mock business data — say so plainly
    // rather than fabricating an outcome.
    return buildMessage(
      req.businessId,
      "I'm not connected to the support backend right now. Set EXPO_PUBLIC_API_URL and restart to go live."
    );
  }
  return sendChatLive(req);
}

/** Derive a short conversation title from the opening user message. */
export function deriveTitle(text: string): string {
  const clean = text.trim().replace(/\s+/g, " ");
  if (clean.length <= 42) return clean;
  return `${clean.slice(0, 42).trimEnd()}…`;
}
