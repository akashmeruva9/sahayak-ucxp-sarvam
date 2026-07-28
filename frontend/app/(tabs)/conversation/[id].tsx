import { useLocalSearchParams } from "expo-router";
import { ConversationScreen } from "@/screens/ConversationScreen";

export default function ConversationRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <ConversationScreen id={id} />;
}
