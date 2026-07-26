import { useEffect } from "react";
import { View } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

interface WaveformProps {
  active: boolean;
  barCount?: number;
  color?: string;
  height?: number;
}

const MIN = 0.18;

function Bar({
  active,
  color,
  height,
  seed,
}: {
  active: boolean;
  color: string;
  height: number;
  seed: number;
}) {
  const level = useSharedValue(MIN);

  useEffect(() => {
    if (active) {
      // Each bar breathes at its own pace + amplitude for an organic waveform.
      const peak = 0.55 + ((seed * 37) % 45) / 100; // 0.55 – 1.0
      const duration = 340 + ((seed * 53) % 260); // 340 – 600ms
      level.value = withRepeat(
        withTiming(peak, { duration }),
        -1,
        true
      );
    } else {
      level.value = withTiming(MIN, { duration: 220 });
    }
  }, [active, level, seed]);

  const style = useAnimatedStyle(() => ({
    height: Math.max(4, level.value * height),
  }));

  return (
    <Animated.View
      style={[{ width: 4, borderRadius: 2, backgroundColor: color }, style]}
    />
  );
}

/** Animated audio waveform used during voice recording. */
export function Waveform({
  active,
  barCount = 28,
  color = "#FFFFFF",
  height = 44,
}: WaveformProps) {
  return (
    <View
      className="flex-row items-center justify-center gap-1"
      style={{ height }}
    >
      {Array.from({ length: barCount }).map((_, i) => (
        <Bar key={i} active={active} color={color} height={height} seed={i + 1} />
      ))}
    </View>
  );
}
