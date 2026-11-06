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
  level?: number;
}

const MIN = 0.18;

function Bar({
  active,
  color,
  height,
  seed,
  currentLevel = 0,
}: {
  active: boolean;
  color: string;
  height: number;
  seed: number;
  currentLevel?: number;
}) {
  const barLevel = useSharedValue(MIN);

  useEffect(() => {
    if (active) {
      // Scale with live audio level if present, else organic idle breathing
      const audioFactor = currentLevel > 0.05 ? Math.min(1.0, currentLevel * 2.2) : 0.45;
      const peak = Math.min(1.0, 0.25 + audioFactor * (0.55 + ((seed * 37) % 45) / 100));
      const duration = 240 + ((seed * 53) % 220);
      barLevel.value = withRepeat(withTiming(peak, { duration }), -1, true);
    } else {
      barLevel.value = withTiming(MIN, { duration: 220 });
    }
  }, [active, barLevel, seed, currentLevel]);

  const style = useAnimatedStyle(() => ({
    height: Math.max(4, barLevel.value * height),
  }));

  return (
    <Animated.View
      style={[{ width: 4, borderRadius: 2, backgroundColor: color }, style]}
    />
  );
}

/** Animated audio waveform with real-time level sensitivity */
export function Waveform({
  active,
  barCount = 28,
  color = "#FFFFFF",
  height = 44,
  level = 0,
}: WaveformProps) {
  return (
    <View
      className="flex-row items-center justify-center gap-1"
      style={{ height }}
    >
      {Array.from({ length: barCount }).map((_, i) => (
        <Bar
          key={i}
          active={active}
          color={color}
          height={height}
          seed={i + 1}
          currentLevel={level}
        />
      ))}
    </View>
  );
}
