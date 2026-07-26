import { useMemo, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import Animated, { FadeInDown } from "react-native-reanimated";
import type { BusinessId, ConversationSummary, SuggestedAction } from "@/types";
import { SUGGESTED_ACTIONS } from "@/constants/suggestions";
import { useConversationStore } from "@/store/useConversationStore";
import { useSendMessage } from "@/hooks/useChat";
import {
  ChatComposer,
  ConversationCard,
  LanguageMarquee,
  ScreenContainer,
  SuggestedActionCard,
  VoiceButton,
  VoiceOverlay,
} from "@/components";

export function HomeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [draft, setDraft] = useState("");
  const [voiceOpen, setVoiceOpen] = useState(false);

  // Height reserved at the bottom so content clears the floating tab bar.
  const tabBarClearance = Math.max(insets.bottom, 12) + 68;

  const conversations = useConversationStore((s) => s.conversations);
  const createConversation = useConversationStore((s) => s.createConversation);
  const { mutate: send } = useSendMessage();

  const recent: ConversationSummary[] = useMemo(
    () =>
      conversations
        .filter((c) => c.messages.length > 0)
        .slice(0, 3)
        .map((c) => {
          const last = c.messages[c.messages.length - 1];
          return {
            id: c.id,
            title: c.title,
            businessId: c.businessId,
            preview: last?.text ?? "",
            updatedAt: c.updatedAt,
          };
        }),
    [conversations]
  );

  const openConversation = (text: string, businessId?: BusinessId) => {
    const id = createConversation(businessId);
    router.push(`/conversation/${id}`);
    send({ conversationId: id, text, businessId });
  };

  const handleSuggestion = (action: SuggestedAction) =>
    openConversation(action.prompt, action.businessId);

  const handleSend = () => {
    if (!draft.trim()) return;
    const text = draft.trim();
    setDraft("");
    openConversation(text);
  };

  return (
    <ScreenContainer>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        className="flex-1"
        keyboardVerticalOffset={8}
      >
        <ScrollView
          className="flex-1"
          contentContainerClassName="px-5 pb-4 pt-2"
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Header */}
          <Animated.View entering={FadeInDown.duration(400)}>
            <Text className="text-[32px] font-bold tracking-tight text-ink dark:text-white">
              OneSupport
            </Text>
            <Text className="mt-1 text-[16px] text-ink-muted dark:text-white/50">
              Talk to any business.
            </Text>
          </Animated.View>

          {/* Language showcase — Sarvam-style multilingual strip */}
          <View className="mt-6 -mx-5">
            <Text className="mb-2.5 px-5 text-[13px] font-semibold uppercase tracking-wider text-ink-faint dark:text-white/40">
              Speak in your language
            </Text>
            <LanguageMarquee />
          </View>

          {/* Recent conversations */}
          {recent.length > 0 ? (
            <View className="mt-8">
              <SectionLabel>Recent</SectionLabel>
              <View className="gap-2.5">
                {recent.map((c, i) => (
                  <ConversationCard
                    key={c.id}
                    conversation={c}
                    index={i}
                    compact
                    onPress={(id) => router.push(`/conversation/${id}`)}
                  />
                ))}
              </View>
            </View>
          ) : null}

          {/* Suggested actions */}
          <View className="mt-8">
            <SectionLabel>Suggested for you</SectionLabel>
            <View className="flex-row flex-wrap gap-3">
              {SUGGESTED_ACTIONS.map((action, i) => (
                <View key={action.id} style={{ width: "47.5%" }} className="grow">
                  <SuggestedActionCard action={action} index={i} onPress={handleSuggestion} />
                </View>
              ))}
            </View>
          </View>

        </ScrollView>

        {/* Input dock: large mic + composer, seated above the floating tab bar */}
        <View
          className="px-5 pt-1"
          style={{ paddingBottom: tabBarClearance }}
        >
          <Animated.View
            entering={FadeInDown.delay(200).duration(420)}
            className="mb-3 items-center"
          >
            <VoiceButton onPress={() => setVoiceOpen(true)} size={62} />
            <Text className="-mt-1 text-[13px] font-medium text-ink-muted dark:text-white/50">
              Tap to speak
            </Text>
          </Animated.View>

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
        onResult={(transcript) => openConversation(transcript)}
      />
    </ScreenContainer>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <Text className="mb-3 text-[13px] font-semibold uppercase tracking-wider text-ink-faint dark:text-white/40">
      {children}
    </Text>
  );
}
