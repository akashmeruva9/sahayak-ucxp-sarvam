import { useMemo, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import Animated, { FadeInDown } from "react-native-reanimated";
import { Phone } from "lucide-react-native";
import type { BusinessId, ConversationSummary } from "@/types";
import { useConversationStore } from "@/store/useConversationStore";
import { useBusinesses } from "@/hooks/useBusinesses";
import { useSendMessage } from "@/hooks/useChat";
import {
  ChatComposer,
  ConversationCard,
  LanguageMarquee,
  MAX_CONTENT_WIDTH,
  ScreenContainer,
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
  // Loads + caches the business directory app-wide.
  useBusinesses();

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

  const handleSend = () => {
    if (!draft.trim()) return;
    const text = draft.trim();
    setDraft("");
    openConversation(text);
  };

  return (
    <ScreenContainer capped={false}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        className="flex-1"
        keyboardVerticalOffset={8}
      >
        <ScrollView
          className="flex-1"
          // grow + centre so the hero sits optically centred and an empty Home
          // reads as composed rather than as a screen with a hole in it.
          contentContainerClassName={`pb-4 pt-2 flex-grow items-center ${
            recent.length === 0 ? "justify-center" : ""
          }`}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Hero — centred, narrow measure. */}
          <Animated.View
            entering={FadeInDown.duration(400)}
            className="w-full self-center items-center px-6"
            style={{ maxWidth: MAX_CONTENT_WIDTH }}
          >
            <Text className="text-[13px] font-semibold uppercase tracking-[2px] text-accent">
              Speak in your language
            </Text>
            <Text className="mt-4 text-center text-[40px] font-bold leading-[46px] tracking-tight text-ink dark:text-white">
              Talk to any business
            </Text>
            <Text className="mt-3 text-center text-[16px] leading-6 text-ink-muted dark:text-white/50">
              One place for every company. Ask in your own language and the job
              gets done — tracked, refunded, resolved.
            </Text>
          </Animated.View>

          {/* Full-bleed language band. Escaping the centred column is what
              stops the strip wrapping into two static rows inside a narrow
              measure — and it reads as a band, like Sarvam's logo strip. */}
          <View className="mt-9 w-full">
            <LanguageMarquee />
          </View>

          {/* Recent conversations */}
          {recent.length > 0 ? (
            <View
              className="mt-10 w-full self-center px-5"
              style={{ maxWidth: MAX_CONTENT_WIDTH }}
            >
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

        </ScrollView>

        {/* Input dock: large mic + composer, seated above the floating tab bar */}
        <View
          className="w-full self-center px-5 pt-1"
          style={{ maxWidth: MAX_CONTENT_WIDTH, paddingBottom: tabBarClearance }}
        >
          <Animated.View
            entering={FadeInDown.delay(200).duration(420)}
            className="mb-3 items-center"
          >
            <View className="flex-row items-center gap-5">
              <VoiceButton onPress={() => setVoiceOpen(true)} size={62} />
              {/* The central line: say the business and the runtime routes,
                  exactly like the chat above. */}
              <Pressable
                onPress={() => router.push("/call/general")}
                accessibilityRole="button"
                accessibilityLabel="Start a voice call"
                className="h-[52px] w-[52px] items-center justify-center rounded-full border border-hairline dark:border-hairline-dark"
                style={{ backgroundColor: "#0EA66E14" }}
              >
                <Phone size={22} color="#0EA66E" />
              </Pressable>
            </View>
            <Text className="mt-1 text-[13px] font-medium text-ink-muted dark:text-white/50">
              Tap to speak · or call
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
