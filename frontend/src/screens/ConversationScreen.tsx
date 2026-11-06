import { useCallback, useEffect, useRef, useState } from "react";
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { ArrowRight, ChevronLeft, Phone, Sparkles } from "lucide-react-native";
import type { Message } from "@/types";
import { pickDocument } from "@/api/documents";
import { getBusiness } from "@/constants/businesses";
import { palette } from "@/constants/theme";
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
  const insets = useSafeAreaInsets();
  const composerInset = Math.max(insets.bottom, 12);
  const listRef = useRef<FlatList<Message>>(null);
  const [draft, setDraft] = useState("");
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [attaching, setAttaching] = useState(false);

  const conversation = useConversationStore((s) => s.getConversation(id));
  const setActive = useConversationStore((s) => s.setActive);
  const sendDocument = useConversationStore((s) => s.sendDocument);
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

  const handleAttach = useCallback(async () => {
    if (attaching) return;
    setAttaching(true);
    try {
      const file = await pickDocument();
      if (!file) return;
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
    <ScreenContainer>
      {/* Header */}
      <View className="flex-row items-center border-b border-hairline/60 px-3 pb-3 dark:border-hairline-dark/60">
        <Pressable
          onPress={() => router.back()}
          hitSlop={10}
          className="h-9 w-9 items-center justify-center rounded-full active:scale-95 transition"
        >
          <ChevronLeft size={26} color={colors.text} />
        </Pressable>
        <View className="ml-2 flex-1">
          <View className="flex-row items-center">
            <Text
              className="text-[16px] font-bold text-ink dark:text-white"
              numberOfLines={1}
            >
              {conversation?.businessId ? business.name : "Sahayak Support"}
            </Text>
            {conversation?.businessId ? (
              <View className="ml-1.5 rounded-full bg-emerald-500/15 px-1.5 py-0.2 dark:bg-emerald-500/20">
                <Text className="text-[9px] font-bold text-emerald-600 dark:text-emerald-400">
                  VERIFIED
                </Text>
              </View>
            ) : null}
          </View>
          <Text className="text-[11px] text-ink-muted dark:text-white/40" numberOfLines={1}>
            {conversation?.businessId ? `${business.category} · UCXP` : "Universal Support · 22 Languages"}
          </Text>
        </View>

        {/* Call button */}
        <Pressable
          onPress={() => router.push(`/call/${callTarget}?conversationId=${id}`)}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Call instead"
          className="h-9 flex-row items-center rounded-full bg-emerald-500/15 px-3 active:scale-95 transition"
        >
          <Phone size={14} color="#0EA66E" strokeWidth={2.4} />
          <Text className="ml-1.5 text-[12.5px] font-bold text-emerald-600 dark:text-emerald-400">
            Call
          </Text>
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
          renderItem={({ item }) => (
            <ChatBubble
              message={item}
              onSelectSuggestion={(text) => send({ conversationId: id, text })}
            />
          )}
          contentContainerClassName="px-4 pt-4 pb-4"
          showsVerticalScrollIndicator={false}
          onContentSizeChange={scrollToEnd}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={
            <View className="mt-14 items-center px-4">
              <View className="mb-3 h-12 w-12 items-center justify-center rounded-2xl bg-accent/15">
                <Sparkles size={24} color={palette.accent} strokeWidth={2.2} />
              </View>
              <Text className="text-center text-[18px] font-bold text-ink dark:text-white">
                {conversation?.businessId
                  ? `Welcome to ${business.name}`
                  : "How can Sahayak help?"}
              </Text>
              <Text className="mt-1 text-center text-[13px] text-ink-muted dark:text-white/50">
                {conversation?.businessId
                  ? "Ask about orders, refunds or returns."
                  : "One assistant for every Indian business."}
              </Text>

              {/* Starter Quick Actions */}
              <View className="mt-5 w-full gap-2">
                {[
                  conversation?.businessId
                    ? `Where is my order from ${business.name}?`
                    : "Track my order with Deepika Andhra Pickles",
                  conversation?.businessId
                    ? `What is the refund policy for ${business.name}?`
                    : "Check order status from Ravi Electronics",
                ].map((prompt, pIdx) => (
                  <Pressable
                    key={pIdx}
                    onPress={() => send({ conversationId: id, text: prompt })}
                    className="flex-row items-center rounded-xl border border-hairline/90 bg-surface px-3.5 py-2.5 active:scale-98 transition dark:border-white/10 dark:bg-elevated-dark shadow-2xs"
                  >
                    <Text className="flex-1 text-[13px] font-medium text-ink dark:text-white">
                      "{prompt}"
                    </Text>
                    <ArrowRight size={13} color={palette.accent} />
                  </Pressable>
                ))}
              </View>
            </View>
          }
        />

        <View
          style={{ paddingBottom: composerInset }}
          className="border-t border-hairline/60 bg-surface/80 backdrop-blur-md px-3 pt-2.5 dark:border-hairline-dark/60 dark:bg-surface-dark/80"
        >
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
