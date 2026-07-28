import { Platform, Pressable, TextInput, View } from "react-native";
import type { NativeSyntheticEvent, TextInputKeyPressEventData } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { ArrowUp, Mic, Paperclip } from "lucide-react-native";
import { useThemeColors } from "@/hooks/useThemeColors";
import { BrandGradient } from "./BrandGradient";

interface ChatComposerProps {
  value: string;
  onChangeText: (text: string) => void;
  onSend: () => void;
  onMic: () => void;
  /** Attach a PDF or photo. Omit to hide the button (screens without upload). */
  onAttach?: () => void;
  /** Disables attach while an upload is in flight. */
  attaching?: boolean;
  placeholder?: string;
  autoFocus?: boolean;
}

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/** The rounded input bar with mic + send, used on Home and in Conversation. */
export function ChatComposer({
  value,
  onChangeText,
  onSend,
  onMic,
  onAttach,
  attaching = false,
  placeholder = "Ask anything…",
  autoFocus = false,
}: ChatComposerProps) {
  const { colors } = useThemeColors();
  const canSend = value.trim().length > 0;

  /**
   * Enter sends, Shift+Enter breaks the line — the convention every assistant
   * on the web already trained people on.
   *
   * `onSubmitEditing` can't do this: a multiline TextInput on web is a
   * <textarea>, where Enter is a newline and the submit event never fires. On
   * the phone the return key is a newline key and that's the right behaviour,
   * so this is deliberately web-only.
   */
  const onKeyPress =
    Platform.OS === "web"
      ? (e: NativeSyntheticEvent<TextInputKeyPressEventData>) => {
          const ev = e as unknown as { shiftKey?: boolean; preventDefault?: () => void };
          if (e.nativeEvent.key !== "Enter" || ev.shiftKey) return;
          ev.preventDefault?.();
          if (canSend) onSend();
        }
      : undefined;

  const sendStyle = useAnimatedStyle(() => ({
    opacity: withTiming(canSend ? 1 : 0, { duration: 160 }),
    transform: [{ scale: withTiming(canSend ? 1 : 0.6, { duration: 160 }) }],
  }));
  const micStyle = useAnimatedStyle(() => ({
    opacity: withTiming(canSend ? 0 : 1, { duration: 160 }),
    transform: [{ scale: withTiming(canSend ? 0.6 : 1, { duration: 160 }) }],
  }));

  return (
    <View className="flex-row items-end rounded-3xl border border-hairline bg-surface px-2 py-2 dark:border-hairline-dark dark:bg-elevated-dark">
      {onAttach ? (
        <Pressable
          onPress={onAttach}
          disabled={attaching}
          hitSlop={6}
          accessibilityLabel="Attach a PDF or photo"
          accessibilityRole="button"
          className="h-10 w-10 items-center justify-center rounded-full"
          style={{ opacity: attaching ? 0.4 : 1 }}
        >
          <Paperclip size={21} color={colors.textMuted} />
        </Pressable>
      ) : null}

      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textFaint}
        autoFocus={autoFocus}
        multiline
        onSubmitEditing={() => canSend && onSend()}
        onKeyPress={onKeyPress}
        className="max-h-28 flex-1 px-3 py-2 text-[16px] text-ink dark:text-white"
        style={{ lineHeight: 21 }}
      />

      <View className="h-10 w-10 items-center justify-center">
        <AnimatedPressable
          pointerEvents={canSend ? "none" : "auto"}
          onPress={onMic}
          style={[{ position: "absolute" }, micStyle]}
          className="h-10 w-10 items-center justify-center rounded-full"
        >
          <Mic size={22} color={colors.textMuted} />
        </AnimatedPressable>

        <AnimatedPressable
          pointerEvents={canSend ? "auto" : "none"}
          onPress={() => canSend && onSend()}
          style={[{ position: "absolute" }, sendStyle]}
          className="h-10 w-10 items-center justify-center rounded-full"
          hitSlop={6}
        >
          <View
            className="h-10 w-10 items-center justify-center overflow-hidden rounded-full"
          >
            <BrandGradient />
            <ArrowUp size={22} color="#FFFFFF" strokeWidth={2.6} />
          </View>
        </AnimatedPressable>
      </View>
    </View>
  );
}
