import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { ArrowRight, ChevronLeft, Phone, Sparkles } from "lucide-react-native";
import { GRADIENT, palette } from "@/constants/theme";
import { getBusiness } from "@/constants/businesses";
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
  const business = getBusiness(conversation?.businessId);

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
    <ScreenContainer edges={[]}>
      {/* Header */}
      <View className="w-full items-center border-b border-hairline/60 bg-surface/80 backdrop-blur-md px-8 py-3 dark:border-hairline-dark/60 dark:bg-surface-dark/80">
        <View className="w-full flex-row items-center" style={{ maxWidth: MEASURE }}>
          <Pressable
            onPress={() => router.back()}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Back"
            className="-ml-2 h-9 w-9 items-center justify-center rounded-full hover:bg-elevated dark:hover:bg-elevated-dark active:scale-95 transition"
          >
            <ChevronLeft size={24} color={colors.text} />
          </Pressable>

          {/* Header Title with Merchant Metadata or Universal Assistant status */}
          <View className="ml-2 flex-1">
            <View className="flex-row items-center">
              <Text className="text-[16px] font-bold text-ink dark:text-white" numberOfLines={1}>
                {conversation?.businessId ? business.name : "Sahayak Support"}
              </Text>
              {conversation?.businessId ? (
                <View className="ml-2 rounded-full bg-emerald-500/15 px-2 py-0.5 dark:bg-emerald-500/20">
                  <Text className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400">
                    VERIFIED MERCHANT
                  </Text>
                </View>
              ) : (
                <View className="ml-2 flex-row items-center rounded-full bg-emerald-500/15 px-2 py-0.5 dark:bg-emerald-500/20">
                  <View className="mr-1.5 h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  <Text className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400">
                    ONLINE · 22 LANGUAGES
                  </Text>
                </View>
              )}
            </View>
            <Text className="text-[12px] text-ink-muted dark:text-white/40" numberOfLines={1}>
              {conversation?.businessId
                ? `${business.category} · UCXP Protocol Resolution`
                : "Ask about any business, orders, refunds, and support"}
            </Text>
          </View>

          {/* Call Agent Button */}
          <Pressable
            onPress={() => router.push(`/call/${callTarget}?conversationId=${id}`)}
            accessibilityRole="button"
            accessibilityLabel="Call instead"
            className="h-9 flex-row items-center overflow-hidden rounded-full px-4 shadow-md transition duration-150 hover:brightness-110 active:scale-[0.97]"
            style={{
              shadowColor: GRADIENT.to,
              shadowOpacity: 0.35,
              shadowRadius: 10,
              shadowOffset: { width: 0, height: 4 },
            }}
          >
            <BrandGradient />
            <View className="flex-row items-center" style={{ zIndex: 1 }}>
              <Phone size={14} color="#FFFFFF" strokeWidth={2.6} />
              <Text className="ml-1.5 text-[13px] font-bold text-white tracking-wide">Call Agent</Text>
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
            <View className="mt-14 items-center px-4">
              <View className="mb-4 h-14 w-14 items-center justify-center rounded-3xl bg-accent/15 shadow-xs">
                <Sparkles size={28} color={palette.accent} strokeWidth={2.2} />
              </View>
              <Text className="text-center text-[20px] font-bold text-ink dark:text-white">
                {conversation?.businessId
                  ? `Welcome to ${business.name}`
                  : "How can Sahayak help you today?"}
              </Text>
              <Text className="mt-1.5 max-w-md text-center text-[14px] text-ink-muted dark:text-white/50">
                {conversation?.businessId
                  ? `Ask about recent orders, deliveries, refunds, or support policies.`
                  : "One unified assistant across all Indian merchants in any language."}
              </Text>

              {/* Starter Quick Actions */}
              <View className="mt-6 w-full max-w-md gap-2.5">
                {[
                  conversation?.businessId
                    ? `Where is my order from ${business.name}?`
                    : "Track my order with Deepika Andhra Pickles",
                  conversation?.businessId
                    ? `What is the refund policy for ${business.name}?`
                    : "Check order status from Ravi Electronics",
                  "Which businesses can I get support for?",
                ].map((prompt, pIdx) => (
                  <Pressable
                    key={pIdx}
                    onPress={() => send({ conversationId: id, text: prompt })}
                    className="flex-row items-center rounded-xl border border-hairline/90 bg-surface px-4 py-3 shadow-2xs hover:border-accent hover:bg-accent/5 active:scale-[0.98] transition dark:border-white/10 dark:bg-elevated-dark"
                  >
                    <Text className="flex-1 text-[13.5px] font-medium text-ink dark:text-white">
                      "{prompt}"
                    </Text>
                    <ArrowRight size={14} color={palette.accent} />
                  </Pressable>
                ))}
              </View>
            </View>
          ) : (
            messages.map((m) => (
              <ChatBubble
                key={m.id}
                message={m}
                onSelectSuggestion={(text) => send({ conversationId: id, text })}
              />
            ))
          )}
        </View>
      </ScrollView>

      {/* Docked composer */}
      <View className="w-full items-center border-t border-hairline/60 bg-surface/60 backdrop-blur-md px-8 pb-7 pt-4 dark:border-hairline-dark/60 dark:bg-surface-dark/60">
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
