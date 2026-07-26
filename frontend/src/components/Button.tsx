import { ActivityIndicator, Pressable, Text, View } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import type { LucideIcon } from "lucide-react-native";
import { useThemeColors } from "@/hooks/useThemeColors";
import { palette } from "@/constants/theme";
import { BrandGradient } from "./BrandGradient";

type Variant = "primary" | "secondary" | "ghost";
type Size = "md" | "lg";

interface ButtonProps {
  label: string;
  onPress?: () => void;
  variant?: Variant;
  size?: Size;
  icon?: LucideIcon;
  loading?: boolean;
  disabled?: boolean;
  className?: string;
  haptic?: boolean;
}

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

const containerByVariant: Record<Variant, string> = {
  primary: "overflow-hidden",
  secondary: "bg-surface dark:bg-elevated-dark border border-hairline dark:border-hairline-dark",
  ghost: "bg-transparent",
};

const textByVariant: Record<Variant, string> = {
  primary: "text-white",
  secondary: "text-ink dark:text-white",
  ghost: "text-accent",
};

export function Button({
  label,
  onPress,
  variant = "primary",
  size = "md",
  icon: Icon,
  loading = false,
  disabled = false,
  className,
  haptic = true,
}: ButtonProps) {
  const { colors } = useThemeColors();
  const scale = useSharedValue(1);
  const isDisabled = disabled || loading;

  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  const iconColor =
    variant === "primary"
      ? "#FFFFFF"
      : variant === "ghost"
        ? palette.accent
        : colors.text;

  return (
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled }}
      disabled={isDisabled}
      onPressIn={() => (scale.value = withTiming(0.96, { duration: 120 }))}
      onPressOut={() => (scale.value = withTiming(1, { duration: 160 }))}
      onPress={() => {
        if (isDisabled) return;
        if (haptic) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
        onPress?.();
      }}
      style={animatedStyle}
      className={`flex-row items-center justify-center rounded-card ${
        size === "lg" ? "px-6 py-4" : "px-5 py-3"
      } ${containerByVariant[variant]} ${isDisabled ? "opacity-50" : ""} ${className ?? ""}`}
    >
      {variant === "primary" ? <BrandGradient /> : null}
      {loading ? (
        <ActivityIndicator color={variant === "primary" ? "#fff" : colors.text} />
      ) : (
        <View className="flex-row items-center">
          {Icon ? <Icon size={size === "lg" ? 20 : 18} color={iconColor} /> : null}
          <Text
            className={`font-semibold ${size === "lg" ? "text-[17px]" : "text-[15px]"} ${
              Icon ? "ml-2" : ""
            } ${textByVariant[variant]}`}
          >
            {label}
          </Text>
        </View>
      )}
    </AnimatedPressable>
  );
}
