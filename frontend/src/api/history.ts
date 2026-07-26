import type { ConversationSummary } from "@/types";
import { useConversationStore } from "@/store/useConversationStore";
import { networkDelay } from "./client";

/**
 * GET /history — returns lightweight summaries. Reads from the local store so
 * newly created conversations appear after a query invalidation, exactly as a
 * real endpoint would return freshly persisted rows.
 *
 * Still local even in live mode: the AI Engine is stateless by design and owns
 * no database. Persistence belongs to the UCXP Runtime, so this is the one
 * endpoint that cannot be wired until `backend/` exists.
 */
export async function fetchHistory(): Promise<ConversationSummary[]> {
  await networkDelay(300, 700);
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
    })
    .sort((a, b) => b.updatedAt - a.updatedAt);
}
