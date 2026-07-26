import { useEffect } from "react";
import { Pressable, View } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import { Mic } from "lucide-react-native";
import { GRADIENT } from "@/constants/theme";
import { BrandGradient } from "./BrandGradient";

interface VoiceButtonProps {
  onPress: () => void;
  size?: number;
  /** Shows a continuous pulsing halo to invite interaction. */
  pulse?: boolean;
}

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/** The signature large microphone button on Home. */
export function VoiceButton({ onPress, size = 76, pulse = true }: VoiceButtonProps) {
  const press = useSharedValue(1);
  const halo = useSharedValue(0);

  useEffect(() => {
    if (pulse) {
      halo.value = withRepeat(withTiming(1, { duration: 1800 }), -1, false);
    }
  }, [halo, pulse]);

  const haloStyle = useAnimatedStyle(() => ({
    opacity: (1 - halo.value) * 0.35,
    transform: [{ scale: 1 + halo.value * 0.4 }],
  }));

  const pressStyle = useAnimatedStyle(() => ({ transform: [{ scale: press.value }] }));

  return (
    <View className="items-center justify-center" style={{ width: size * 1.5, height: size * 1.5 }}>
      {pulse ? (
        <Animated.View
          pointerEvents="none"
          style={[
            {
              position: "absolute",
              width: size,
              height: size,
              borderRadius: size,
              backgroundColor: GRADIENT.to,
            },
            haloStyle,
          ]}
        />
      ) : null}

      <AnimatedPressable
        accessibilityRole="button"
        accessibilityLabel="Start voice input"
        onPressIn={() => (press.value = withTiming(0.92, { duration: 120 }))}
        onPressOut={() =>
          (press.value = withSequence(
            withTiming(1.04, { duration: 140 }),
            withTiming(1, { duration: 120 })
          ))
        }
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
          onPress();
        }}
        style={[
          {
            width: size,
            height: size,
            borderRadius: size,
            overflow: "hidden",
            shadowColor: GRADIENT.to,
            shadowOpacity: 0.45,
            shadowRadius: 20,
            shadowOffset: { width: 0, height: 10 },
            elevation: 8,
          },
          pressStyle,
        ]}
        className="items-center justify-center"
      >
        <BrandGradient />
        <Mic size={size * 0.4} color="#FFFFFF" strokeWidth={2.2} />
      </AnimatedPressable>
    </View>
  );
}
