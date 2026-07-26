import { useEffect } from "react";
import { Text, View, useWindowDimensions } from "react-native";
import { useRouter } from "expo-router";
import Animated, {
  FadeIn,
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import { BrandGradient, LoadingDots, ScreenContainer } from "@/components";
import { GRADIENT, palette } from "@/constants/theme";
import { ALPHABET_GLYPHS } from "@/constants/alphabets";
import { useThemeColors } from "@/hooks/useThemeColors";

/** Branded splash → a Sarvam-style wall of language scripts, then auto-advances. */
export function SplashScreen() {
  const router = useRouter();
  const { colors, isDark } = useThemeColors();
  const { width, height } = useWindowDimensions();

  const scale = useSharedValue(0.7);
  const glow = useSharedValue(0);
  const wall = useSharedValue(1.06);

  useEffect(() => {
    scale.value = withSequence(
      withTiming(1.08, { duration: 420 }),
      withTiming(1, { duration: 260 })
    );
    glow.value = withDelay(200, withTiming(1, { duration: 600 }));
    wall.value = withTiming(1, { duration: 2200 });

    const t = setTimeout(() => router.replace("/home"), 1800);
    return () => clearTimeout(t);
  }, [glow, router, scale, wall]);

  const logoStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const glowStyle = useAnimatedStyle(() => ({ opacity: glow.value * 0.5 }));
  const wallStyle = useAnimatedStyle(() => ({ transform: [{ scale: wall.value }] }));

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
            <Animated.Text
              key={i}
              entering={FadeIn.delay(Math.min(i * 6, 500)).duration(500)}
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
            </Animated.Text>
          );
        })}
      </Animated.View>

      {/* Brand panel over the wall */}
      <View className="flex-1 items-center justify-center px-8">
        <Animated.View
          entering={FadeIn.duration(500)}
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
              <BrandGradient />
              <Text className="text-[42px]" style={{ lineHeight: 50, color: "#FFFFFF" }}>
                ✦
              </Text>
            </Animated.View>
          </View>

          <Animated.Text
            entering={FadeInDown.delay(280).duration(500)}
            className="mt-6 text-[30px] font-bold tracking-tight text-ink dark:text-white"
          >
            OneSupport
          </Animated.Text>
          <Animated.Text
            entering={FadeInDown.delay(400).duration(500)}
            className="mt-2 text-center text-[13px] font-medium leading-[19px] text-ink-muted dark:text-white/50"
          >
            One Place · Every Business · Every Language
          </Animated.Text>
        </Animated.View>
      </View>

      <Animated.View entering={FadeIn.delay(600)} className="absolute inset-x-0 bottom-14 items-center">
        <LoadingDots color={palette.accent} size={8} />
      </Animated.View>
    </ScreenContainer>
  );
}
