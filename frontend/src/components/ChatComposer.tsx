import { useState } from "react";
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
   * Drives the focus ring. Tracked in state rather than with a `focus-within`
   * class because that variant only exists on web — this way the bar reacts
   * identically wherever it renders.
   */
  const [focused, setFocused] = useState(false);

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
    <View
      className={`flex-row items-end rounded-3xl border bg-surface px-2 py-2 transition-colors duration-150 dark:bg-elevated-dark ${
        focused
          ? "border-accent/60"
          : "border-hairline hover:border-ink-faint dark:border-hairline-dark dark:hover:border-white/20"
      }`}
    >
      {onAttach ? (
        <Pressable
          onPress={onAttach}
          disabled={attaching}
          hitSlop={6}
          accessibilityLabel="Attach a PDF or photo"
          accessibilityRole="button"
          className="h-10 w-10 items-center justify-center rounded-full transition duration-150 hover:bg-ink/[0.07] active:scale-90 dark:hover:bg-white/10"
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
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        // react-native-web paints its own focus outline on the input; the ring
        // belongs on the bar around it, not on the text box inside it.
        style={{ lineHeight: 21, outlineWidth: 0 } as never}
        className="max-h-28 flex-1 px-3 py-2 text-[16px] text-ink dark:text-white"
      />

      <View className="h-10 w-10 items-center justify-center">
        <AnimatedPressable
          pointerEvents={canSend ? "none" : "auto"}
          onPress={onMic}
          style={[{ position: "absolute" }, micStyle]}
          className="h-10 w-10 items-center justify-center rounded-full transition duration-150 hover:bg-ink/[0.07] active:scale-90 dark:hover:bg-white/10"
        >
          <Mic size={22} color={colors.textMuted} />
        </AnimatedPressable>

        <AnimatedPressable
          pointerEvents={canSend ? "auto" : "none"}
          onPress={() => canSend && onSend()}
          style={[{ position: "absolute" }, sendStyle]}
          className="h-10 w-10 items-center justify-center rounded-full transition duration-150 hover:brightness-110 active:scale-90"
          hitSlop={6}
        >
          <View
            className="h-10 w-10 items-center justify-center overflow-hidden rounded-full"
          >
            <BrandGradient />
            {/* The gradient is absolutely positioned, so on web it paints over
                any static sibling. The arrow has to opt back on top. */}
            <View style={{ zIndex: 1 }}>
              <ArrowUp size={22} color="#FFFFFF" strokeWidth={2.6} />
            </View>
          </View>
        </AnimatedPressable>
      </View>
    </View>
  );
}
