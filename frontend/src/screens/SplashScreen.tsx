import { useEffect, useState } from "react";
import { Image, Platform, Text, View, useWindowDimensions } from "react-native";
import { useRouter } from "expo-router";
import Animated, {
  FadeIn,
  FadeInDown,
  FadeOutUp,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import { LoadingDots, ScreenContainer } from "@/components";
import { GRADIENT, palette } from "@/constants/theme";
import { ALPHABET_GLYPHS } from "@/constants/alphabets";
import { LANGUAGE_GREETINGS } from "@/constants/languages";
import { useThemeColors } from "@/hooks/useThemeColors";

/**
 * Reanimated `entering` animations stall under react-native-web: the view mounts
 * at its initial opacity and never advances until something forces a repaint, so
 * the screen sits there greyed out or invisible. Web gets the same layout with
 * no entrance; the phone keeps it.
 */
const WEB = Platform.OS === "web";

/** Branded splash → a Sarvam-style wall of language scripts, then auto-advances. */
export function SplashScreen() {
  const router = useRouter();
  const { colors, isDark } = useThemeColors();
  const { width, height } = useWindowDimensions();

  const scale = useSharedValue(0.7);
  const glow = useSharedValue(0);
  const wall = useSharedValue(1.06);
  const wallFade = useSharedValue(0);
  const [greetIndex, setGreetIndex] = useState(0);

  useEffect(() => {
    scale.value = withSequence(
      withTiming(1.08, { duration: 420 }),
      withTiming(1, { duration: 260 })
    );
    glow.value = withDelay(200, withTiming(1, { duration: 600 }));
    wall.value = withTiming(1, { duration: 2400 });
    wallFade.value = withTiming(1, { duration: 700 });

    const cycle = setInterval(
      () => setGreetIndex((i) => (i + 1) % LANGUAGE_GREETINGS.length),
      560
    );
    const t = setTimeout(() => router.replace("/home"), 2100);
    return () => {
      clearInterval(cycle);
      clearTimeout(t);
    };
  }, [glow, router, scale, wall, wallFade]);

  const greeting = LANGUAGE_GREETINGS[greetIndex];

  const logoStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const glowStyle = useAnimatedStyle(() => ({ opacity: glow.value * 0.5 }));
  const wallStyle = useAnimatedStyle(() => ({
    opacity: wallFade.value,
    transform: [{ scale: wall.value }],
  }));

  // Build a grid that covers the screen.
  const cols = Math.max(6, Math.round(width / 56));
  const cellW = width / cols;
  const rows = Math.ceil(height / cellW) + 1;
  const count = cols * rows;
  const glyphSize = Math.round(cellW * 0.42);

  const spectrum = [GRADIENT.from, GRADIENT.mid, GRADIENT.to];

  return (
    <ScreenContainer edges={[]}>
      {/* Language wall */}
      <Animated.View
        pointerEvents="none"
        style={[{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }, wallStyle]}
        className="flex-row flex-wrap items-center justify-center"
      >
        {Array.from({ length: count }).map((_, i) => {
          const glyph = ALPHABET_GLYPHS[i % ALPHABET_GLYPHS.length];
          // Sprinkle the blue→orange spectrum through the field.
          const lit = i % 8 === 3;
          const color = lit ? spectrum[Math.floor(i / 8) % 3] : colors.textFaint;
          const opacity = lit ? 0.85 : isDark ? 0.16 : 0.24;
          return (
            <Text
              key={i}
              style={{
                width: cellW,
                height: cellW,
                lineHeight: cellW,
                textAlign: "center",
                fontSize: glyphSize,
                color,
                opacity,
              }}
            >
              {glyph}
            </Text>
          );
        })}
      </Animated.View>

      {/* Brand panel over the wall */}
      <View className="flex-1 items-center justify-center px-8">
        <Animated.View
          entering={WEB ? undefined : FadeIn.duration(500)}
          className="items-center rounded-3xl border border-hairline/60 bg-canvas/80 px-10 py-9 dark:border-hairline-dark/60 dark:bg-canvas-dark/80"
        >
          <View className="items-center justify-center">
            <Animated.View
              pointerEvents="none"
              style={[
                {
                  position: "absolute",
                  width: 150,
                  height: 150,
                  borderRadius: 44,
                  backgroundColor: GRADIENT.to,
                },
                glowStyle,
              ]}
            />
            <Animated.View
              style={[
                {
                  width: 88,
                  height: 88,
                  borderRadius: 25,
                  overflow: "hidden",
                  shadowColor: GRADIENT.to,
                  shadowOpacity: 0.5,
                  shadowRadius: 24,
                  shadowOffset: { width: 0, height: 12 },
                },
                logoStyle,
              ]}
              className="items-center justify-center"
            >
              <Image
                source={require("../../assets/logo.png")}
                style={{ width: "100%", height: "100%" }}
                resizeMode="cover"
                accessibilityLabel="Sahayak"
              />
            </Animated.View>
          </View>

          <Animated.Text
            entering={WEB ? undefined : FadeInDown.delay(280).duration(500)}
            className="mt-6 text-[28px] font-bold tracking-tight text-ink dark:text-white"
          >
            Sahayak
          </Animated.Text>

          {/* The "different languages" animation — greeting cycles across scripts */}
          <View className="mt-4 h-16 w-full items-center justify-center">
            <Animated.View
              key={greeting.code}
              entering={WEB ? undefined : FadeInDown.duration(340)}
              exiting={FadeOutUp.duration(280)}
              style={{ position: "absolute" }}
              className="items-center"
            >
              <Text className="text-[34px] font-bold text-ink dark:text-white">
                {greeting.hello}
              </Text>
              <Text className="mt-1 text-[11px] font-semibold uppercase tracking-[3px] text-accent">
                {greeting.native}
              </Text>
            </Animated.View>
          </View>

          <Animated.Text
            entering={WEB ? undefined : FadeInDown.delay(400).duration(500)}
            className="mt-3 text-center text-[13px] font-medium leading-[19px] text-ink-muted dark:text-white/50"
          >
            One Place · Every Business · Every Language
          </Animated.Text>
        </Animated.View>
      </View>

      <Animated.View entering={WEB ? undefined : FadeIn.delay(600)} className="absolute inset-x-0 bottom-14 items-center">
        <LoadingDots color={palette.accent} size={8} />
      </Animated.View>
    </ScreenContainer>
  );
}
