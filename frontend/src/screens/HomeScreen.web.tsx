import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { router } from "expo-router";
import Animated, { FadeInDown } from "react-native-reanimated";
import { Phone } from "lucide-react-native";
import { useConversationStore } from "@/store/useConversationStore";
import { useSendMessage } from "@/hooks/useChat";
import { ChatComposer, LanguageMarquee } from "@/components";
import { palette } from "@/constants/theme";

/**
 * Home, desktop edition. Web only — Metro resolves this instead of
 * HomeScreen.tsx, so the phone layout is untouched.
 *
 * Laid out the way every assistant is: a thin band on top, the canvas in the
 * middle, and the input docked at the bottom where the hand already is. The
 * composer never moves, so the page reads as one conversation surface rather
 * than a marketing page with a text box somewhere in it.
 */
const MEASURE = 720;

export function HomeScreen() {
  const [draft, setDraft] = useState("");
  const createConversation = useConversationStore((s) => s.createConversation);
  const { mutate: send } = useSendMessage();

  const start = () => {
    const text = draft.trim();
    if (!text) return;
    const id = createConversation();
    setDraft("");
    router.push(`/conversation/${id}`);
    send({ conversationId: id, text });
  };

  return (
    <View className="flex-1">
      {/* Top band — the multilingual promise, stated before anything else. */}
      <View className="border-b border-hairline/60 py-4 dark:border-hairline-dark/60">
        <LanguageMarquee />
      </View>

      {/* Canvas */}
      <ScrollView
        className="flex-1"
        contentContainerClassName="flex-grow items-center justify-center px-10 py-12"
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <Animated.View
          entering={FadeInDown.duration(420)}
          className="w-full items-center"
          style={{ maxWidth: MEASURE }}
        >
          <Text className="text-center text-[46px] font-bold leading-[54px] tracking-tight text-ink dark:text-white">
            Talk to any business
          </Text>
          <Text className="mt-4 text-center text-[17px] leading-7 text-ink-muted dark:text-white/50">
            Ask in your own language and the job actually gets done — tracked,
            refunded, resolved. Name the business and I'll take it from there.
          </Text>
        </Animated.View>
      </ScrollView>

      {/* Docked composer — fixed at the bottom, like every assistant. */}
      <View className="w-full items-center border-t border-hairline/60 px-10 pb-8 pt-5 dark:border-hairline-dark/60">
        <View className="w-full" style={{ maxWidth: MEASURE }}>
          <ChatComposer
            value={draft}
            onChangeText={setDraft}
            onSend={start}
            onMic={() => router.push("/call/general")}
          />
          <Pressable
            onPress={() => router.push("/call/general")}
            className="mt-3 flex-row items-center justify-center self-center rounded-full border border-hairline/80 px-4 py-2 dark:border-hairline-dark/80"
          >
            <Phone size={15} color={palette.accent} strokeWidth={2.2} />
            <Text className="ml-2 text-[13.5px] font-semibold text-ink-soft dark:text-white/70">
              Or start a voice call
            </Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}
