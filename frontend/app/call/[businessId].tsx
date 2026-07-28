import { useLocalSearchParams } from "expo-router";
import { CallScreen } from "@/screens/CallScreen";

/**
 * `/call/<business-id>` is that merchant's own voice line — pinned, never routed
 * elsewhere. `/call/general` is the central line, where the runtime picks the
 * business from what the caller says. Same rule as chat.
 */
export default function CallRoute() {
  const { businessId } = useLocalSearchParams<{ businessId: string }>();
  const scoped = businessId && businessId !== "general" ? businessId : undefined;
  return <CallScreen businessId={scoped} />;
}
