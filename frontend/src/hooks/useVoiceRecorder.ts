import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Platform } from "react-native";
import {
  AudioModule,
  RecordingPresets,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from "expo-audio";

export type RecordingIssue = "permission-denied" | "web-unsupported" | "recorder-error";

export interface StartResult {
  ok: boolean;
  issue?: RecordingIssue;
}

export interface Clip {
  uri: string | null;
  durationMs: number;
}

export interface VoiceRecorderOptions {
  /** Callback triggered when speech is followed by silenceThresholdMs of pause */
  onSilenceTimeout?: () => void;
  /** Silence pause duration in milliseconds to trigger onSilenceTimeout (default: 3000ms) */
  silenceThresholdMs?: number;
  /** Minimum ms of active speech needed before pause detection is armed (default: 600ms) */
  minSpeechMs?: number;
}

export function useVoiceRecorder(options?: VoiceRecorderOptions) {
  const recorder = useAudioRecorder({ ...RecordingPresets.HIGH_QUALITY, isMeteringEnabled: true });
  const recorderState = useAudioRecorderState(recorder, 100);

  const [isRecording, setIsRecording] = useState(false);
  const [durationMs, setDurationMs] = useState(0);
  const [audioLevel, setAudioLevel] = useState(0);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [silenceRemainingMs, setSilenceRemainingMs] = useState(3000);

  const optionsRef = useRef(options);
  optionsRef.current = options;

  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedAt = useRef(0);
  const speechAccumulatedMs = useRef(0);
  const hasSpoken = useRef(false);
  const lastSpeechAt = useRef(0);
  const silenceFired = useRef(false);

  useEffect(() => {
    if (!isRecording) return;
    const metering = recorderState.metering;
    if (typeof metering === "number") {
      const norm = Math.max(0, Math.min(1, (metering + 60) / 60));
      setAudioLevel(norm);
      const nowSpeaking = metering > -38;
      setIsSpeaking(nowSpeaking);

      const silenceLimit = optionsRef.current?.silenceThresholdMs ?? 3000;
      const minSpeech = optionsRef.current?.minSpeechMs ?? 600;
      const now = Date.now();

      if (nowSpeaking) {
        speechAccumulatedMs.current += 100;
        if (speechAccumulatedMs.current >= minSpeech) {
          hasSpoken.current = true;
        }
        lastSpeechAt.current = now;
        setSilenceRemainingMs(silenceLimit);
      } else {
        if (hasSpoken.current && lastSpeechAt.current > 0) {
          const silenceElapsed = now - lastSpeechAt.current;
          const remaining = Math.max(0, silenceLimit - silenceElapsed);
          setSilenceRemainingMs(remaining);

          if (silenceElapsed >= silenceLimit && !silenceFired.current) {
            silenceFired.current = true;
            optionsRef.current?.onSilenceTimeout?.();
          }
        }
      }
    }
  }, [recorderState, isRecording]);

  const clearTimer = useCallback(() => {
    if (timer.current) {
      clearInterval(timer.current);
      timer.current = null;
    }
  }, []);

  const settle = useCallback(async () => {
    try {
      if (recorder.isRecording) await recorder.stop();
    } catch {
      /* Already stopped, or never started. Nothing to do either way. */
    }
  }, [recorder]);

  const start = useCallback(async (): Promise<StartResult> => {
    if (Platform.OS === "web") return { ok: false, issue: "web-unsupported" };

    try {
      const permission = await AudioModule.requestRecordingPermissionsAsync();
      if (!permission.granted) return { ok: false, issue: "permission-denied" };

      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });

      await settle();
      await recorder.prepareToRecordAsync();
      recorder.record();

      startedAt.current = Date.now();
      speechAccumulatedMs.current = 0;
      hasSpoken.current = false;
      lastSpeechAt.current = 0;
      silenceFired.current = false;

      const silenceLimit = optionsRef.current?.silenceThresholdMs ?? 3000;
      setSilenceRemainingMs(silenceLimit);
      setDurationMs(0);
      setIsRecording(true);
      clearTimer();

      timer.current = setInterval(() => {
        setDurationMs(Date.now() - startedAt.current);
      }, 100);

      return { ok: true };
    } catch {
      await settle();
      setIsRecording(false);
      clearTimer();
      return { ok: false, issue: "recorder-error" };
    }
  }, [recorder, settle, clearTimer]);

  const stop = useCallback(async (): Promise<Clip> => {
    const elapsed = Date.now() - startedAt.current;
    clearTimer();
    setIsRecording(false);
    setAudioLevel(0);
    setIsSpeaking(false);
    await settle();
    return { uri: recorder.uri ?? null, durationMs: elapsed };
  }, [recorder, settle, clearTimer]);

  const cancel = useCallback(async () => {
    clearTimer();
    setIsRecording(false);
    setAudioLevel(0);
    setIsSpeaking(false);
    setDurationMs(0);
    await settle();
  }, [settle, clearTimer]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      if (next !== "background") return;
      clearTimer();
      setIsRecording(false);
      setAudioLevel(0);
      setIsSpeaking(false);
      void settle();
    });
    return () => sub.remove();
  }, [settle, clearTimer]);

  useEffect(
    () => () => {
      clearTimer();
      void settle();
    },
    [settle, clearTimer]
  );

  return {
    isRecording,
    durationMs,
    audioLevel,
    isSpeaking,
    silenceRemainingMs,
    start,
    stop,
    cancel,
  };
}
