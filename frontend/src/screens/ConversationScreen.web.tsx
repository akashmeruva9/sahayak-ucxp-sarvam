import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { ChevronLeft, Phone } from "lucide-react-native";
import { GRADIENT } from "@/constants/theme";
import { pickDocument } from "@/api/documents";
import { useConversationStore } from "@/store/useConversationStore";
import { useSendMessage } from "@/hooks/useChat";
import {
  BrandGradient,
  ChatBubble,
  ChatComposer,
  ScreenContainer,
  VoiceOverlay,
} from "@/components";
import { useThemeColors } from "@/hooks/useThemeColors";

/**
 * A conversation, desktop edition. Web only — Metro resolves this instead of
 * ConversationScreen.tsx, so the phone layout is untouched.
 *
 * Same three parts as the phone (header, thread, composer), laid out for a
 * wide window: the thread is measured rather than full-bleed, because a line
 * of text 1400px wide is unreadable, and the composer is docked at the bottom
 * so it sits where it does on Home. Call is a labelled pill here rather than a
 * bare icon — there's room for the word, and a lone glyph in a wide header
 * reads as decoration.
 */
const MEASURE = 760;

export function ConversationScreen({ id }: { id: string }) {
  const router = useRouter();
  const { colors } = useThemeColors();
  const scrollRef = useRef<ScrollView>(null);
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
    requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
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

  const callTarget =
    conversation?.scoped && conversation.businessId ? conversation.businessId : "general";

  return (
    <ScreenContainer edges={[]}>
      {/* Header */}
      <View className="w-full items-center border-b border-hairline/60 px-8 py-3.5 dark:border-hairline-dark/60">
        <View className="w-full flex-row items-center" style={{ maxWidth: MEASURE }}>
          <Pressable
            onPress={() => router.back()}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Back"
            className="-ml-2 h-9 w-9 items-center justify-center rounded-full hover:bg-elevated dark:hover:bg-elevated-dark"
          >
            <ChevronLeft size={24} color={colors.text} />
          </Pressable>

          <Text
            className="ml-2 flex-1 text-[17px] font-semibold text-ink dark:text-white"
            numberOfLines={1}
          >
            {conversation?.title ?? "Conversation"}
          </Text>

          {/* Same conversation, by voice. Scoped chats call that business; a
              general chat opens the central line. */}
          <Pressable
            onPress={() => router.push(`/call/${callTarget}`)}
            accessibilityRole="button"
            accessibilityLabel="Call instead"
            className="h-9 flex-row items-center overflow-hidden rounded-full px-4"
            style={{
              shadowColor: GRADIENT.to,
              shadowOpacity: 0.3,
              shadowRadius: 10,
              shadowOffset: { width: 0, height: 4 },
            }}
          >
            <BrandGradient />
            <View className="flex-row items-center" style={{ zIndex: 1 }}>
              <Phone size={15} color="#FFFFFF" strokeWidth={2.4} />
              <Text className="ml-1.5 text-[13.5px] font-semibold text-white">Call</Text>
            </View>
          </Pressable>
        </View>
      </View>

      {/* Thread */}
      <ScrollView
        ref={scrollRef}
        className="flex-1"
        contentContainerClassName="items-center px-8 py-6"
        onContentSizeChange={scrollToEnd}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View className="w-full" style={{ maxWidth: MEASURE }}>
          {messages.length === 0 ? (
            <Text className="mt-24 text-center text-[15px] text-ink-muted dark:text-white/40">
              Start the conversation — ask about an order, a bill, an appointment, anything.
            </Text>
          ) : (
            messages.map((m) => <ChatBubble key={m.id} message={m} />)
          )}
        </View>
      </ScrollView>

      {/* Docked composer, at the same measure as the thread above it. */}
      <View className="w-full items-center border-t border-hairline/60 px-8 pb-7 pt-4 dark:border-hairline-dark/60">
        <View className="w-full" style={{ maxWidth: MEASURE }}>
          <ChatComposer
            value={draft}
            onChangeText={setDraft}
            onSend={handleSend}
            onMic={() => setVoiceOpen(true)}
            onAttach={handleAttach}
            attaching={attaching}
          />
        </View>
      </View>

      <VoiceOverlay
        visible={voiceOpen}
        onClose={() => setVoiceOpen(false)}
        onResult={(transcript) => send({ conversationId: id, text: transcript })}
      />
    </ScreenContainer>
  );
}
