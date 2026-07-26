import { useCallback, useEffect, useRef, useState } from "react";
import { Platform } from "react-native";
import {
  AudioModule,
  RecordingPresets,
  setAudioModeAsync,
  useAudioRecorder,
} from "expo-audio";

export interface VoiceResult {
  uri: string | null;
  durationMs: number;
  /** Why no file was produced, when `uri` is null. */
  issue?: RecordingIssue;
}

/** Why real capture was unavailable — drives an actionable message in the UI. */
export type RecordingIssue = "permission-denied" | "web-unsupported" | "recorder-error";

type RecorderState = "idle" | "requesting" | "recording";

/**
 * Wraps expo-audio recording with a live timer and graceful fallbacks so the
 * voice flow always works in a demo — even on web or when a device denies the
 * mic. The waveform visualization is handled separately by <Waveform />.
 */
export function useVoiceRecorder() {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [state, setState] = useState<RecorderState>("idle");
  const [durationMs, setDurationMs] = useState(0);
  const [issue, setIssue] = useState<RecordingIssue | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedAt = useRef(0);
  const simulated = useRef(false);
  const issueRef = useRef<RecordingIssue | null>(null);

  const flagIssue = useCallback((reason: RecordingIssue) => {
    simulated.current = true;
    issueRef.current = reason;
    setIssue(reason);
    if (__DEV__) console.warn(`[recorder] real capture unavailable: ${reason}`);
  }, []);

  const clearTimer = useCallback(() => {
    if (timer.current) {
      clearInterval(timer.current);
      timer.current = null;
    }
  }, []);

  useEffect(() => () => clearTimer(), [clearTimer]);

  const beginTimer = useCallback(() => {
    startedAt.current = Date.now();
    setDurationMs(0);
    clearTimer();
    timer.current = setInterval(() => {
      setDurationMs(Date.now() - startedAt.current);
    }, 100);
  }, [clearTimer]);

  const start = useCallback(async () => {
    setState("requesting");
    simulated.current = false;
    issueRef.current = null;
    setIssue(null);
    try {
      if (Platform.OS === "web") {
        // expo-audio recording isn't wired for web here.
        flagIssue("web-unsupported");
        setState("recording");
        beginTimer();
        return;
      }
      const permission = await AudioModule.requestRecordingPermissionsAsync();
      if (!permission.granted) {
        // Fall back to a simulated capture so the UX never dead-ends, but
        // remember why — silently pretending to record is what made this
        // look like a working demo when the mic was actually blocked.
        flagIssue("permission-denied");
        setState("recording");
        beginTimer();
        return;
      }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      setState("recording");
      beginTimer();
    } catch (err) {
      if (__DEV__) console.warn(`[recorder] start failed: ${String(err)}`);
      flagIssue("recorder-error");
      setState("recording");
      beginTimer();
    }
  }, [beginTimer, flagIssue, recorder]);

  const finish = useCallback(async (): Promise<VoiceResult> => {
    const elapsed = Date.now() - startedAt.current;
    clearTimer();
    setState("idle");
    if (simulated.current) {
      return { uri: null, durationMs: elapsed, issue: issueRef.current ?? "recorder-error" };
    }
    try {
      await recorder.stop();
      const uri = recorder.uri ?? null;
      if (__DEV__) console.log(`[recorder] stopped uri=${uri ?? "NULL"} ms=${elapsed}`);
      return {
        uri,
        durationMs: elapsed,
        issue: uri ? undefined : "recorder-error",
      };
    } catch (err) {
      if (__DEV__) console.warn(`[recorder] stop failed: ${String(err)}`);
      return { uri: null, durationMs: elapsed, issue: "recorder-error" };
    }
  }, [clearTimer, recorder]);

  const cancel = useCallback(async () => {
    clearTimer();
    setState("idle");
    setDurationMs(0);
    if (!simulated.current) {
      try {
        await recorder.stop();
      } catch {
        /* no-op */
      }
    }
  }, [clearTimer, recorder]);

  return {
    isRecording: state === "recording",
    isPreparing: state === "requesting",
    durationMs,
    /** Non-null when the mic isn't actually capturing — surface it, don't fake it. */
    issue,
    start,
    finish,
    cancel,
  };
}
