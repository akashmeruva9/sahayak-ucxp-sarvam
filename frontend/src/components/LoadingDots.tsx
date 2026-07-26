import { useEffect } from "react";
import { View } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import { useThemeColors } from "@/hooks/useThemeColors";

interface LoadingDotsProps {
  color?: string;
  size?: number;
}

function Dot({ delay, color, size }: { delay: number; color: string; size: number }) {
  const progress = useSharedValue(0);
  useEffect(() => {
    progress.value = withDelay(
      delay,
      withRepeat(
        withSequence(
          withTiming(1, { duration: 320 }),
          withTiming(0, { duration: 320 })
        ),
        -1
      )
    );
  }, [delay, progress]);

  const style = useAnimatedStyle(() => ({
    opacity: 0.35 + progress.value * 0.65,
    transform: [{ translateY: -progress.value * 3 }],
  }));

  return (
    <Animated.View
      style={[{ width: size, height: size, borderRadius: size, backgroundColor: color }, style]}
    />
  );
}

/** Three-dot "assistant is typing" indicator. */
export function LoadingDots({ color, size = 7 }: LoadingDotsProps) {
  const { colors } = useThemeColors();
  const dotColor = color ?? colors.textMuted;
  return (
    <View className="flex-row items-center gap-1.5">
      <Dot delay={0} color={dotColor} size={size} />
      <Dot delay={140} color={dotColor} size={size} />
      <Dot delay={280} color={dotColor} size={size} />
    </View>
  );
}
