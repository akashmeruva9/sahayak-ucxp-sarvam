import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { BusinessId } from "@/types";
import { useConversationStore } from "@/store/useConversationStore";

interface SendArgs {
  conversationId: string;
  text: string;
  businessId?: BusinessId;
}

/**
 * UI-facing send hook. Delegates all state mutation to the store (keeping
 * business logic out of components) and refreshes the History query when done.
 */
export function useSendMessage() {
  const sendMessage = useConversationStore((s) => s.sendMessage);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ conversationId, text, businessId }: SendArgs) =>
      sendMessage(conversationId, text, businessId),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["history"] });
    },
  });
}
