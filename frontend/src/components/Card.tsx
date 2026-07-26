import { Pressable, View, type ViewProps } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import * as Haptics from "expo-haptics";

interface CardProps extends ViewProps {
  children: React.ReactNode;
  onPress?: () => void;
  className?: string;
  /** Adds a soft elevation shadow. */
  elevated?: boolean;
  haptic?: boolean;
}

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/**
 * The base surface used across the app. Static when no `onPress`, otherwise a
 * spring-scaling pressable with a light haptic — the Apple Wallet feel.
 */
export function Card({
  children,
  onPress,
  className,
  elevated = true,
  haptic = true,
  ...rest
}: CardProps) {
  const scale = useSharedValue(1);
  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  const surface = `rounded-card bg-elevated dark:bg-elevated-dark border border-hairline/70 dark:border-hairline-dark/70 ${
    elevated ? "shadow-sm shadow-black/5" : ""
  } ${className ?? ""}`;

  if (!onPress) {
    return (
      <View className={surface} {...rest}>
        {children}
      </View>
    );
  }

  return (
    <AnimatedPressable
      onPressIn={() => (scale.value = withTiming(0.975, { duration: 120 }))}
      onPressOut={() => (scale.value = withTiming(1, { duration: 180 }))}
      onPress={() => {
        if (haptic) Haptics.selectionAsync().catch(() => {});
        onPress();
      }}
      style={animatedStyle}
      className={surface}
      {...rest}
    >
      {children}
    </AnimatedPressable>
  );
}
