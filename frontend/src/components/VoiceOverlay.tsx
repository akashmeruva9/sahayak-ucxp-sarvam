import { useEffect, useState } from "react";
import { Modal, Platform, Pressable, Text, View } from "react-native";
import Animated, { FadeIn, FadeInUp, FadeOut } from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import { Check, X } from "lucide-react-native";
import { useVoiceRecorder, type RecordingIssue } from "@/hooks/useVoiceRecorder";
import { transcribeVoice } from "@/api/voice";
import { isMockMode } from "@/api/client";
import { formatDuration } from "@/utils/time";
import { palette } from "@/constants/theme";
import { Waveform } from "./Waveform";
import { LoadingDots } from "./LoadingDots";

/**
 * Reanimated `entering` animations stall under react-native-web: the view mounts
 * at its initial opacity and never advances until something forces a repaint, so
 * the screen sits there greyed out or invisible. Web gets the same layout with
 * no entrance; the phone keeps it.
 */
const WEB = Platform.OS === "web";

interface VoiceOverlayProps {
  visible: boolean;
  onClose: () => void;
  onResult: (transcript: string) => void;
}

/** Why the mic isn't capturing, in words the user can act on. */
const ISSUE_MESSAGE: Record<RecordingIssue, string> = {
  "permission-denied":
    "Microphone access is blocked. Enable it in Settings → Expo Go → Microphone, then reopen the app.",
  "web-unsupported":
    "This browser doesn't support recording. Try Chrome, Edge or Safari.",
  "recorder-error":
    "The microphone couldn't start. Close any other app using it and try again.",
};

/** Full-screen voice capture: waveform, live timer, transcription hand-off. */
export function VoiceOverlay({ visible, onClose, onResult }: VoiceOverlayProps) {
  const { isRecording, durationMs, start, stop, cancel } = useVoiceRecorder();
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Say it up front rather than letting someone speak into a dead mic and only
  // find out when the turn fails. `start` now reports why instead of falling
  // back to a simulated capture, so the message is exact.
  useEffect(() => {
    if (!visible) return;
    setProcessing(false);
    setError(null);
    void (async () => {
      const result = await start();
      if (result.ok || isMockMode()) return;
      setError(ISSUE_MESSAGE[result.issue ?? "recorder-error"]);
    })();
    // Recorder cleanup is handled by the hook on unmount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const handleCancel = async () => {
    await cancel();
    onClose();
  };

  const handleStop = async () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    const result = await stop();
    setProcessing(true);
    try {
      const { transcript } = await transcribeVoice(result);
      setProcessing(false);
      onClose();
      onResult(transcript);
    } catch (err) {
      // Show why, in place. Closing silently would look like the mic simply
      // didn't hear anything, which is what sent us debugging last time.
      setProcessing(false);
      const message = err instanceof Error ? err.message : "Transcription failed.";
      setError(message);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleCancel}>
      <View className="flex-1 items-center justify-center bg-black/60 px-8">
        <Animated.View
          entering={WEB ? undefined : FadeInUp.duration(280)}
          exiting={FadeOut.duration(160)}
          className="w-full items-center rounded-3xl bg-elevated px-6 py-10 dark:bg-elevated-dark"
        >
          <Text
            className={`text-[13px] font-semibold uppercase tracking-widest ${
              error ? "text-rose-500" : "text-accent"
            }`}
          >
            {error ? "Couldn't transcribe" : processing ? "Transcribing" : "Listening"}
          </Text>

          <View className="my-8 h-16 w-full items-center justify-center">
            {processing ? (
              <LoadingDots color={palette.accent} size={9} />
            ) : (
              <Waveform active={isRecording} color={palette.accent} height={56} barCount={26} />
            )}
          </View>

          <Text className="mb-8 text-[34px] font-semibold text-ink dark:text-white">
            {formatDuration(durationMs)}
          </Text>

          {error ? (
            <Animated.View entering={WEB ? undefined : FadeIn} className="w-full items-center">
              <Text className="mb-6 text-center text-[14px] leading-5 text-ink-muted dark:text-white/60">
                {error}
              </Text>
              <ControlButton onPress={handleCancel} tone="neutral">
                <X size={26} color="#64748B" />
              </ControlButton>
            </Animated.View>
          ) : !processing ? (
            <Animated.View entering={WEB ? undefined : FadeIn} className="flex-row items-center gap-8">
              <ControlButton onPress={handleCancel} tone="neutral">
                <X size={26} color="#64748B" />
              </ControlButton>
              <ControlButton onPress={handleStop} tone="accent">
                <Check size={30} color="#FFFFFF" strokeWidth={2.4} />
              </ControlButton>
            </Animated.View>
          ) : (
            <Text className="text-[14px] text-ink-muted dark:text-white/50">
              Understanding what you said…
            </Text>
          )}
        </Animated.View>
      </View>
    </Modal>
  );
}

function ControlButton({
  children,
  onPress,
  tone,
}: {
  children: React.ReactNode;
  onPress: () => void;
  tone: "neutral" | "accent";
}) {
  const isAccent = tone === "accent";
  return (
    <Pressable
      onPress={onPress}
      className={`items-center justify-center rounded-full ${
        isAccent ? "" : "border border-hairline dark:border-hairline-dark"
      }`}
      style={{
        width: isAccent ? 72 : 60,
        height: isAccent ? 72 : 60,
        backgroundColor: isAccent ? palette.accent : "transparent",
      }}
    >
      {children}
    </Pressable>
  );
}
