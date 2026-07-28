import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Platform } from "react-native";
import {
  AudioModule,
  RecordingPresets,
  setAudioModeAsync,
  useAudioRecorder,
} from "expo-audio";

/** Why capture couldn't start — each maps to something the user can act on. */
export type RecordingIssue = "permission-denied" | "web-unsupported" | "recorder-error";

export interface StartResult {
  ok: boolean;
  issue?: RecordingIssue;
}

export interface Clip {
  /** The recorded file, or null if nothing was captured. */
  uri: string | null;
  durationMs: number;
}

/**
 * Recording, reduced to the two things a call actually needs: start, and stop
 * with the file.
 *
 * It reports failure rather than dressing it up. An earlier version fell back to
 * a "simulated" capture whenever the microphone was unavailable — the timer ran,
 * the waveform moved, and nothing was recorded — so a blocked mic looked exactly
 * like a working one until the turn failed at the far end. If capture can't
 * start, `start()` says so and the caller shows why.
 *
 * There is deliberately no metering here. Ending a turn on silence needs a
 * speech threshold, and no threshold survives contact with real rooms: the same
 * silent room reads -50dB on one handset and -24dB on another, so the level that
 * means "talking" on one device means "empty room" on the next. The call ends
 * turns on a button press instead.
 */
export function useVoiceRecorder() {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [isRecording, setIsRecording] = useState(false);
  const [durationMs, setDurationMs] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedAt = useRef(0);

  const clearTimer = useCallback(() => {
    if (timer.current) {
      clearInterval(timer.current);
      timer.current = null;
    }
  }, []);

  /**
   * Stop only when the recorder says it is running.
   *
   * stop() on an idle recorder throws, and the throw leaves expo-audio still
   * believing it is recording. That stale flag crashes the app: when Android
   * backgrounds the activity, expo-audio pauses every recorder it thinks is
   * live, and MediaRecorder.pause() on one that isn't is a native
   * IllegalStateException — which takes down the process, not just the call.
   */
  const settle = useCallback(async () => {
    try {
      if (recorder.isRecording) await recorder.stop();
    } catch (err) {
      if (__DEV__) console.warn(`[recorder] stop failed: ${String(err)}`);
    }
  }, [recorder]);

  const start = useCallback(async (): Promise<StartResult> => {
    if (Platform.OS === "web") return { ok: false, issue: "web-unsupported" };

    try {
      const permission = await AudioModule.requestRecordingPermissionsAsync();
      if (!permission.granted) return { ok: false, issue: "permission-denied" };

      // Playing the previous reply leaves the session in playback mode, and a
      // call starts recording again the moment that reply finishes.
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });

      // Never prepare on top of a live recorder: back-to-back turns are the
      // normal case here, not the exception.
      await settle();
      await recorder.prepareToRecordAsync();
      recorder.record();

      startedAt.current = Date.now();
      setDurationMs(0);
      setIsRecording(true);
      clearTimer();
      timer.current = setInterval(() => {
        setDurationMs(Date.now() - startedAt.current);
      }, 100);
      return { ok: true };
    } catch (err) {
      if (__DEV__) console.warn(`[recorder] start failed: ${String(err)}`);
      await settle();
      setIsRecording(false);
      clearTimer();
      return { ok: false, issue: "recorder-error" };
    }
  }, [recorder, settle, clearTimer]);

  /** Stop, and hand back the file. */
  const stop = useCallback(async (): Promise<Clip> => {
    const elapsed = Date.now() - startedAt.current;
    clearTimer();
    setIsRecording(false);
    await settle();
    // Read the uri after stopping, whether or not we were the one to stop it.
    return { uri: recorder.uri ?? null, durationMs: elapsed };
  }, [recorder, settle, clearTimer]);

  /** Stop, and throw the recording away. */
  const cancel = useCallback(async () => {
    clearTimer();
    setIsRecording(false);
    setDurationMs(0);
    await settle();
  }, [settle, clearTimer]);

  /**
   * Close the mic when the app really goes away.
   *
   * "background" only: Android also reports "inactive" for anything that
   * briefly covers the window — the notification shade, a permission sheet —
   * and tearing the recorder down for those kills turns that have only just
   * begun, which reads as the microphone simply not working.
   */
  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      if (next !== "background") return;
      clearTimer();
      setIsRecording(false);
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

  return { isRecording, durationMs, start, stop, cancel };
}
