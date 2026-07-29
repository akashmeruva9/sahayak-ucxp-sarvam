import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { router } from "expo-router";
import { Phone } from "lucide-react-native";
import { GRADIENT } from "@/constants/theme";
import { useConversationStore } from "@/store/useConversationStore";
import { useSendMessage } from "@/hooks/useChat";
import { BrandGradient, ChatComposer, LanguageMarquee } from "@/components";

/**
 * Reanimated `entering` animations stall on web: elements stay at their initial
 * opacity until something forces a repaint, so the page reads as half-loaded
 * until the user scrolls. The web screens therefore render statically — the
 * native screens keep their entrance animations.
 */

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
        <View
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
        </View>
      </ScrollView>

      {/* Docked composer — fixed at the bottom, like every assistant. */}
      <View className="w-full items-center border-t border-hairline/60 px-10 pb-8 pt-5 dark:border-hairline-dark/60">
        <View className="w-full" style={{ maxWidth: MEASURE }}>
          {/* Composer and call sit on one row. A floating circle above the
              input is a phone pattern — on a wide canvas the two ways to start
              belong side by side, at the same height, both obviously clickable. */}
          <View className="flex-row items-end gap-3">
            <View className="flex-1">
              <ChatComposer
                value={draft}
                onChangeText={setDraft}
                onSend={start}
                onMic={() => router.push("/call/general")}
              />
            </View>

            <Pressable
              onPress={() => router.push("/call/general")}
              accessibilityRole="button"
              accessibilityLabel="Start a voice call"
              className="h-[52px] flex-row items-center overflow-hidden rounded-2xl px-5 transition duration-150 hover:brightness-110 active:scale-[0.97]"
              style={{
                shadowColor: GRADIENT.to,
                shadowOpacity: 0.35,
                shadowRadius: 14,
                shadowOffset: { width: 0, height: 6 },
              }}
            >
              <BrandGradient />
              <View className="flex-row items-center" style={{ zIndex: 1 }}>
                <Phone size={17} color="#FFFFFF" strokeWidth={2.4} />
                <Text className="ml-2 text-[14.5px] font-semibold text-white">Call</Text>
              </View>
            </Pressable>
          </View>

          <Text className="mt-2.5 text-center text-[12.5px] text-ink-faint dark:text-white/35">
            Type, or call and speak in any language
          </Text>
        </View>
      </View>
    </View>
  );
}
