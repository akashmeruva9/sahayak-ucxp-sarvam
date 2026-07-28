import type { BusinessId, ConversationSummary } from "@/types";
import { useConversationStore } from "@/store/useConversationStore";
import { getJson, isMockMode, networkDelay } from "./client";

/**
 * GET /history — past conversations.
 *
 * The runtime is the source of truth: it persists every turn, across the app,
 * WhatsApp and calls, and returns the signed-in user's durable history when the
 * request carries a session token. Reading the local store instead (which is
 * what this did) meant History only ever showed the current app session and
 * emptied on restart — conversations held by the backend were invisible.
 *
 * Conversations started in this session are merged on top, so a chat opened
 * seconds ago appears immediately rather than after the runtime has persisted
 * it.
 */
interface RuntimeHistoryRow {
  id: string;
  business_id?: string | null;
  language?: string;
  turns?: number;
  preview?: string;
  /** Unix seconds. */
  updated_at?: number;
  title?: string | null;
}

interface RuntimeHistoryResponse {
  conversations?: RuntimeHistoryRow[];
}

/** Locally-known conversations, used as the mock source and as a live overlay. */
function localSummaries(): ConversationSummary[] {
  const { conversations } = useConversationStore.getState();
  return conversations
    .filter((c) => c.messages.length > 0)
    .map((c) => {
      const last = c.messages[c.messages.length - 1];
      return {
        id: c.id,
        title: c.title,
        businessId: c.businessId,
        preview: last?.pending ? "…" : last?.text ?? "",
        updatedAt: c.updatedAt,
      };
    });
}

function fromRuntime(row: RuntimeHistoryRow): ConversationSummary {
  const preview = (row.preview ?? "").trim();
  return {
    id: row.id,
    // The runtime stores turns, not titles; the last reply is the best label,
    // and the business badge already says who it was with.
    title: row.title?.trim() || (preview.length > 42 ? `${preview.slice(0, 42).trimEnd()}…` : preview) || "Conversation",
    businessId: (row.business_id as BusinessId | undefined) ?? undefined,
    preview,
    // Unix seconds → ms, which is what the UI formats against.
    updatedAt: row.updated_at ? row.updated_at * 1000 : Date.now(),
  };
}

export async function fetchHistory(): Promise<ConversationSummary[]> {
  if (isMockMode()) {
    await networkDelay(300, 700);
    return localSummaries().sort((a, b) => b.updatedAt - a.updatedAt);
  }

  let server: ConversationSummary[] = [];
  try {
    const data = await getJson<RuntimeHistoryResponse>("/history");
    server = (data.conversations ?? []).map(fromRuntime);
  } catch {
    // Offline or signed out: local is better than an empty screen.
    return localSummaries().sort((a, b) => b.updatedAt - a.updatedAt);
  }

  // Local wins on id collisions — it has the freshest text for an open chat.
  const merged = new Map<string, ConversationSummary>();
  for (const row of server) merged.set(row.id, row);
  for (const row of localSummaries()) merged.set(row.id, row);

  return [...merged.values()].sort((a, b) => b.updatedAt - a.updatedAt);
}
