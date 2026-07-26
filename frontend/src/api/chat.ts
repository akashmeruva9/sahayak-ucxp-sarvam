import type { BusinessAction, BusinessId, Message } from "@/types";
import { getBusiness } from "@/constants/businesses";
import { uid } from "@/utils/id";
import { isMockMode, networkDelay, postJson } from "./client";

export interface ChatRequest {
  text: string;
  /** Prior turns, so the mock can stay in-context. */
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

interface Intent {
  match: RegExp;
  businessId: BusinessId;
  reply: string;
  action?: BusinessAction;
}

/**
 * A tiny rules engine that maps free text to a business + canned outcome.
 * This stands in for the UCXP routing + agent layer the backend will provide.
 */
const INTENTS: Intent[] = [
  {
    match: /(flipkart|order|package|delivery|parcel|track)/i,
    businessId: "flipkart",
    reply:
      "I checked your latest Flipkart order. Your package has left the Bengaluru hub and is out for delivery.",
    action: { label: "Order arriving tomorrow", tone: "success" },
  },
  {
    match: /(airtel|fiber|broadband|wifi|internet|cancel connection)/i,
    businessId: "airtel",
    reply:
      "I've raised a cancellation request for your Airtel Fiber connection. A confirmation SMS is on its way and pickup will be scheduled within 48 hours.",
    action: { label: "Cancellation submitted", tone: "warning" },
  },
  {
    match: /(apollo|doctor|appointment|clinic|hospital|consult)/i,
    businessId: "apollo",
    reply:
      "I found availability at Apollo Clinic, Indiranagar. Dr. Meera Rao (General Physician) has an opening tomorrow at 11:30 AM.",
    action: { label: "Slot held for 10 minutes", tone: "info" },
  },
  {
    match: /(hdfc|bank|complaint|transaction|refund|charge|dispute)/i,
    businessId: "hdfc",
    reply:
      "Your complaint has been logged with HDFC Bank. You'll receive updates on the registered mobile number, and resolution is expected within 3 working days.",
    action: { label: "Complaint #HDFC-48213 opened", tone: "info" },
  },
  {
    match: /(swiggy|food|eat|hungry|restaurant|dinner|lunch)/i,
    businessId: "swiggy",
    reply:
      "Your Swiggy order from Meghana Foods is being prepared. The delivery partner will be assigned shortly.",
    action: { label: "Arriving in ~35 min", tone: "success" },
  },
  {
    match: /(irctc|train|ticket|pnr|railway|seat)/i,
    businessId: "irctc",
    reply:
      "Your IRCTC ticket is confirmed. PNR 8452213097 · Coach B4, Seats 32 & 33 on the Shatabdi Express.",
    action: { label: "Booking confirmed", tone: "success" },
  },
];

const GENERIC_REPLY =
  "I can help with that. I'll connect to the right business over UCXP and take care of it — could you share a little more detail so I get it exactly right?";

/** A plausible, in-context support reply for a specific company. */
function contextualReply(businessId: BusinessId): string {
  const name = getBusiness(businessId).name;
  const variants = [
    `Thanks for reaching ${name} support. I've pulled up your account — could you share a reference number (order, ticket, or account ID) so I can be precise?`,
    `You're connected to ${name} over UCXP. I can track requests, resolve issues, or escalate on your behalf. What would you like to do?`,
    `I've logged your request with ${name}. Give me a moment while I check the details — anything specific I should prioritise?`,
  ];
  return variants[Math.floor(Math.random() * variants.length)];
}

function buildMessage(
  businessId: BusinessId,
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

/**
 * Which business a message is about — used only to theme the bubble (badge,
 * colour, avatar). This is a *client-side* affordance: real business routing
 * belongs to the UCXP Runtime, driven by manifests, and replaces this.
 */
function classifyBusiness(text: string, hint?: BusinessId): BusinessId {
  if (hint && hint !== "generic") return hint;
  return INTENTS.find((i) => i.match.test(text))?.businessId ?? "generic";
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
 * Live path: the UCXP Runtime.
 *
 * It detects the language, routes to a business via its manifest, executes a
 * real capability and returns a receipt — so unlike the mock, the outcomes
 * here actually happened. Business routing and memory are server-side; the
 * client just carries the conversation id.
 */
async function sendChatLive(req: ChatRequest): Promise<ChatResponse> {
  const data = await postJson<RuntimeChatResponse>("/chat", {
    text: req.text,
    conversation_id: req.conversationId,
  });

  // The runtime's receipt IS the action card the UI already renders.
  const action: BusinessAction | undefined = data.receipt
    ? { label: data.receipt.label, tone: data.receipt.tone ?? "info" }
    : undefined;

  // Trust the runtime's manifest-driven routing; fall back to the local hint
  // only while it is still deciding (small talk, first turn).
  const businessId = (data.business_id as BusinessId | undefined) ?? classifyBusiness(req.text, req.businessId);

  return buildMessage(businessId, data.reply_text, action);
}

/** POST /chat — returns a single assistant message. */
export async function sendChat(req: ChatRequest): Promise<ChatResponse> {
  if (!isMockMode()) return sendChatLive(req);

  await networkDelay();
  const hint = req.businessId;

  // 1. A specific company is in context (e.g. opened from the directory):
  //    stay scoped to it and never route to a different business.
  if (hint && hint !== "generic") {
    const scripted = INTENTS.find((i) => i.businessId === hint);
    if (scripted && scripted.match.test(req.text)) {
      return buildMessage(scripted.businessId, scripted.reply, scripted.action);
    }
    return buildMessage(hint, contextualReply(hint));
  }

  // 2. No company context — infer intent from the text itself.
  const found = INTENTS.find((i) => i.match.test(req.text));
  if (found) return buildMessage(found.businessId, found.reply, found.action);
  return buildMessage("generic", GENERIC_REPLY);
}

/** Derive a short conversation title from the opening user message. */
export function deriveTitle(text: string): string {
  const clean = text.trim().replace(/\s+/g, " ");
  if (clean.length <= 42) return clean;
  return `${clean.slice(0, 42).trimEnd()}…`;
}
