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
import { ChevronLeft, Phone } from "lucide-react-native";
import type { Message } from "@/types";
import { pickDocument } from "@/api/documents";
import { useConversationStore } from "@/store/useConversationStore";
import { useSendMessage } from "@/hooks/useChat";
import {
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

  const [attaching, setAttaching] = useState(false);

  const conversation = useConversationStore((s) => s.getConversation(id));
  const setActive = useConversationStore((s) => s.setActive);
  const sendDocument = useConversationStore((s) => s.sendDocument);
  const { mutate: send } = useSendMessage();

  const messages = conversation?.messages ?? [];

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

  /**
   * Attach a PDF or photo. Whatever is already typed rides along as the
   * caption — it's the customer's stated intent for the file, and the runtime
   * leads with it instead of guessing.
   */
  const handleAttach = useCallback(async () => {
    if (attaching) return;
    setAttaching(true);
    try {
      const file = await pickDocument();
      if (!file) return; // cancelled — not an error
      const caption = draft.trim();
      setDraft("");
      await sendDocument(id, file, caption, conversation?.businessId);
    } finally {
      setAttaching(false);
    }
  }, [attaching, draft, id, sendDocument, conversation?.businessId]);

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
        {/* Same conversation, by voice. Scoped chats call that business; a
            general chat opens the central line. */}
        <Pressable
          onPress={() =>
            router.push(`/call/${conversation?.scoped && conversation.businessId ? conversation.businessId : "general"}`)
          }
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Call instead"
          className="h-9 w-9 items-center justify-center rounded-full"
          style={{ backgroundColor: "#0EA66E14" }}
        >
          <Phone size={17} color="#0EA66E" />
        </Pressable>
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
            onAttach={handleAttach}
            attaching={attaching}
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
