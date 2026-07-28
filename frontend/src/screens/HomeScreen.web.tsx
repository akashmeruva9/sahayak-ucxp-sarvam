import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { router } from "expo-router";
import Animated, { FadeInDown } from "react-native-reanimated";
import { ArrowUpRight, Mic } from "lucide-react-native";
import type { Business } from "@/types";
import { useBusinesses } from "@/hooks/useBusinesses";
import { useConversationStore } from "@/store/useConversationStore";
import { useSendMessage } from "@/hooks/useChat";
import { ChatComposer, LanguageMarquee } from "@/components";
import { useThemeColors } from "@/hooks/useThemeColors";
import { palette } from "@/constants/theme";

/**
 * Home, desktop edition. Web only — Metro resolves this instead of
 * HomeScreen.tsx, so the phone layout is untouched.
 *
 * The native screen is a phone screen: a bottom-docked composer under a tall
 * empty column. Rendered at 1700px that reads as a stretched app rather than a
 * product, so the web version is built for the shape it actually has — a wide
 * canvas with the sidebar already carrying navigation.
 */
const MEASURE = 720;

export function HomeScreen() {
  const { colors } = useThemeColors();
  const [draft, setDraft] = useState("");
  const { data: businesses = [] } = useBusinesses();
  const createConversation = useConversationStore((s) => s.createConversation);
  const { mutate: send } = useSendMessage();

  const start = (text: string, businessId?: Business["id"]) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const id = createConversation(businessId);
    setDraft("");
    router.push(`/conversation/${id}`);
    send({ conversationId: id, text: trimmed, businessId });
  };

  return (
    <ScrollView
      className="flex-1"
      contentContainerClassName="items-center px-10 pb-16 pt-20"
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      {/* Hero */}
      <Animated.View
        entering={FadeInDown.duration(420)}
        className="w-full items-center"
        style={{ maxWidth: MEASURE }}
      >
        <Text className="text-[12px] font-semibold uppercase tracking-[2.5px] text-accent">
          Speak in your language
        </Text>
        <Text className="mt-5 text-center text-[52px] font-bold leading-[58px] tracking-tight text-ink dark:text-white">
          Talk to any business
        </Text>
        <Text className="mt-4 text-center text-[17px] leading-7 text-ink-muted dark:text-white/50">
          One place for every company. Ask in your own language and the job
          actually gets done — tracked, refunded, resolved.
        </Text>
      </Animated.View>

      {/* Composer — the primary action, given real weight on a wide canvas. */}
      <Animated.View
        entering={FadeInDown.delay(90).duration(420)}
        className="mt-10 w-full"
        style={{ maxWidth: MEASURE }}
      >
        <ChatComposer
          value={draft}
          onChangeText={setDraft}
          onSend={() => start(draft)}
          onMic={() => router.push("/call/general")}
        />
        <Pressable
          onPress={() => router.push("/call/general")}
          className="mt-3 flex-row items-center justify-center self-center rounded-full border border-hairline/80 px-4 py-2 dark:border-hairline-dark/80"
        >
          <Mic size={15} color={palette.accent} strokeWidth={2.2} />
          <Text className="ml-2 text-[13.5px] font-semibold text-ink-soft dark:text-white/70">
            Or start a voice call
          </Text>
        </Pressable>
      </Animated.View>

      {/* Language band — full bleed, like Sarvam's logo strip. */}
      <View className="mt-16 w-full">
        <LanguageMarquee />
      </View>

      {/* The directory, as a grid. Fills the canvas with something useful and
          makes the protocol tangible: every card is a published manifest. */}
      {businesses.length > 0 ? (
        <Animated.View
          entering={FadeInDown.delay(160).duration(420)}
          className="mt-20 w-full"
          style={{ maxWidth: 980 }}
        >
          <Text className="mb-1 text-[12px] font-semibold uppercase tracking-[2px] text-ink-faint dark:text-white/40">
            Live on UCXP
          </Text>
          <Text className="mb-6 text-[15px] text-ink-muted dark:text-white/50">
            Each of these published a manifest. No code was written to support them.
          </Text>

          <View className="flex-row flex-wrap gap-4">
            {businesses.map((b) => (
              <Pressable
                key={b.id}
                onPress={() => start(`I need help with my ${b.name} order`, b.id)}
                className="grow rounded-2xl border border-hairline/70 bg-elevated p-5 dark:border-hairline-dark/70 dark:bg-elevated-dark"
                style={{ minWidth: 260, maxWidth: 320 }}
              >
                <View className="flex-row items-center justify-between">
                  <View
                    className="h-11 w-11 items-center justify-center rounded-xl"
                    style={{ backgroundColor: `${b.color}1A` }}
                  >
                    <Text className="text-[20px]">{b.glyph}</Text>
                  </View>
                  <ArrowUpRight size={18} color={colors.textFaint} />
                </View>
                <Text className="mt-4 text-[16px] font-semibold text-ink dark:text-white">
                  {b.name}
                </Text>
                <Text className="mt-0.5 text-[13px] text-ink-muted dark:text-white/45">
                  {b.category}
                </Text>
                {b.capabilities?.length ? (
                  <View className="mt-3 flex-row flex-wrap gap-1.5">
                    {b.capabilities.slice(0, 3).map((c) => (
                      <View
                        key={c}
                        className="rounded-full bg-surface px-2.5 py-1 dark:bg-surface-dark"
                      >
                        <Text className="text-[11.5px] font-medium text-ink-soft dark:text-white/60">
                          {c.replace(/_/g, " ")}
                        </Text>
                      </View>
                    ))}
                  </View>
                ) : null}
              </Pressable>
            ))}
          </View>
        </Animated.View>
      ) : null}
    </ScrollView>
  );
}
