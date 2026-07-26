import { useEffect, useState } from "react";
import { Modal, Pressable, Text, View } from "react-native";
import Animated, { FadeIn, FadeInUp, FadeOut } from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import { Check, X } from "lucide-react-native";
import { useVoiceRecorder, type RecordingIssue } from "@/hooks/useVoiceRecorder";
import { transcribeVoice } from "@/api/voice";
import { isMockMode, reportDiag } from "@/api/client";
import { formatDuration } from "@/utils/time";
import { palette } from "@/constants/theme";
import { Waveform } from "./Waveform";
import { LoadingDots } from "./LoadingDots";

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
    "Recording isn't supported in the browser yet. Try the app on a phone or simulator.",
  "recorder-error":
    "The microphone couldn't start. Close any other app using it and try again.",
};

/** Full-screen voice capture: waveform, live timer, transcription hand-off. */
export function VoiceOverlay({ visible, onClose, onResult }: VoiceOverlayProps) {
  const { isRecording, durationMs, issue, start, finish, cancel } = useVoiceRecorder();
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setProcessing(false);
      setError(null);
      start();
    }
    // Recorder cleanup is handled by the hook on unmount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // Say it up front rather than letting someone speak into a dead mic and only
  // then fail. In mock mode a simulated capture is intentional, so stay quiet.
  useEffect(() => {
    if (issue && !isMockMode()) {
      reportDiag("recorder.unavailable", { issue });
      setError(ISSUE_MESSAGE[issue]);
    }
  }, [issue]);

  const handleCancel = async () => {
    await cancel();
    onClose();
  };

  const handleStop = async () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    const result = await finish();
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
      if (__DEV__) {
        console.error(
          `[voice] transcribe failed :: ${message} :: recordedUri=${result.uri ?? "NULL"} ` +
            `durationMs=${result.durationMs}`
        );
      }
      reportDiag("voice.failed", {
        message,
        uri: result.uri ?? "NULL",
        durationMs: result.durationMs,
      });
      setError(message);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleCancel}>
      <View className="flex-1 items-center justify-center bg-black/60 px-8">
        <Animated.View
          entering={FadeInUp.duration(280)}
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
            <Animated.View entering={FadeIn} className="w-full items-center">
              <Text className="mb-6 text-center text-[14px] leading-5 text-ink-muted dark:text-white/60">
                {error}
              </Text>
              <ControlButton onPress={handleCancel} tone="neutral">
                <X size={26} color="#64748B" />
              </ControlButton>
            </Animated.View>
          ) : !processing ? (
            <Animated.View entering={FadeIn} className="flex-row items-center gap-8">
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
