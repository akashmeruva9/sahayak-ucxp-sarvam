import { useCallback, useEffect, useRef, useState } from "react";
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Text,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { ChevronLeft } from "lucide-react-native";
import type { Message } from "@/types";
import { getBusiness } from "@/constants/businesses";
import { useConversationStore } from "@/store/useConversationStore";
import { useSendMessage } from "@/hooks/useChat";
import {
  BusinessBadge,
  ChatBubble,
  ChatComposer,
  ScreenContainer,
  VoiceOverlay,
} from "@/components";
import { useThemeColors } from "@/hooks/useThemeColors";

export function ConversationScreen({ id }: { id: string }) {
  const router = useRouter();
  const { colors } = useThemeColors();
  const listRef = useRef<FlatList<Message>>(null);
  const [draft, setDraft] = useState("");
  const [voiceOpen, setVoiceOpen] = useState(false);

  const conversation = useConversationStore((s) => s.getConversation(id));
  const setActive = useConversationStore((s) => s.setActive);
  const { mutate: send } = useSendMessage();

  const messages = conversation?.messages ?? [];
  const business = getBusiness(conversation?.businessId);

  useEffect(() => {
    setActive(id);
    return () => setActive(null);
  }, [id, setActive]);

  const scrollToEnd = useCallback(() => {
    requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
  }, []);

  useEffect(() => {
    scrollToEnd();
  }, [messages.length, scrollToEnd]);

  const handleSend = () => {
    if (!draft.trim()) return;
    const text = draft.trim();
    setDraft("");
    send({ conversationId: id, text });
  };

  return (
    <ScreenContainer>
      {/* Header */}
      <View className="flex-row items-center border-b border-hairline/60 px-3 pb-3 dark:border-hairline-dark/60">
        <Pressable
          onPress={() => router.back()}
          hitSlop={10}
          className="h-9 w-9 items-center justify-center rounded-full"
        >
          <ChevronLeft size={26} color={colors.text} />
        </Pressable>
        <View className="ml-1 flex-1">
          <Text
            className="text-[16px] font-semibold text-ink dark:text-white"
            numberOfLines={1}
          >
            {conversation?.title ?? "Conversation"}
          </Text>
        </View>
        {conversation?.businessId ? (
          <BusinessBadge businessId={conversation.businessId} size="sm" />
        ) : (
          <Text className="text-[13px] font-medium text-ink-muted dark:text-white/40">
            {business.name}
          </Text>
        )}
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={Platform.OS === "ios" ? 0 : 0}
        className="flex-1"
      >
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(m) => m.id}
          renderItem={({ item }) => <ChatBubble message={item} />}
          contentContainerClassName="px-4 pt-4 pb-4"
          showsVerticalScrollIndicator={false}
          onContentSizeChange={scrollToEnd}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={
            <View className="mt-24 items-center px-8">
              <Text className="text-center text-[15px] text-ink-muted dark:text-white/40">
                Start the conversation — ask about an order, a bill, an appointment, anything.
              </Text>
            </View>
          }
        />

        <View className="border-t border-hairline/60 px-4 pb-2 pt-2 dark:border-hairline-dark/60">
          <ChatComposer
            value={draft}
            onChangeText={setDraft}
            onSend={handleSend}
            onMic={() => setVoiceOpen(true)}
          />
        </View>
      </KeyboardAvoidingView>

      <VoiceOverlay
        visible={voiceOpen}
        onClose={() => setVoiceOpen(false)}
        onResult={(transcript) => send({ conversationId: id, text: transcript })}
      />
    </ScreenContainer>
  );
}
