import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Web microphone capture with Voice Activity Detection (VAD) and silence timeout.
 *
 * Same contract as `useVoiceRecorder.ts` so callers (VoiceOverlay, CallScreen)
 * work identically across web and native.
 */
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

type RecorderState = "idle" | "requesting" | "recording";

/** Sarvam reads the container from the filename, so prefer a format it knows. */
function pickMimeType(): string | undefined {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4", // Safari
    "audio/ogg;codecs=opus",
  ];
  const MR = (globalThis as { MediaRecorder?: typeof MediaRecorder }).MediaRecorder;
  if (!MR?.isTypeSupported) return undefined;
  return candidates.find((t) => MR.isTypeSupported(t));
}

export function useVoiceRecorder(options?: VoiceRecorderOptions) {
  const [state, setState] = useState<RecorderState>("idle");
  const [durationMs, setDurationMs] = useState(0);
  const [audioLevel, setAudioLevel] = useState(0);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [silenceRemainingMs, setSilenceRemainingMs] = useState(3000);

  const optionsRef = useRef(options);
  optionsRef.current = options;

  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const stream = useRef<MediaStream | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedAt = useRef(0);

  // Web Audio VAD
  const audioContext = useRef<AudioContext | null>(null);
  const analyser = useRef<AnalyserNode | null>(null);
  const noiseFloor = useRef(0);
  const speechAccumulatedMs = useRef(0);
  const hasSpoken = useRef(false);
  const lastSpeechAt = useRef(0);
  const silenceFired = useRef(false);

  const clearTimer = useCallback(() => {
    if (timer.current) {
      clearInterval(timer.current);
      timer.current = null;
    }
  }, []);

  /** Release the mic and audio context so the browser's recording indicator goes away. */
  const stopTracks = useCallback(() => {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    if (audioContext.current) {
      audioContext.current.close().catch(() => {});
      audioContext.current = null;
    }
    analyser.current = null;
    setAudioLevel(0);
    setIsSpeaking(false);
  }, []);

  useEffect(() => {
    return () => {
      clearTimer();
      stopTracks();
    };
  }, [clearTimer, stopTracks]);

  const start = useCallback(async (): Promise<StartResult> => {
    setState("requesting");
    chunks.current = [];

    const media = globalThis.navigator?.mediaDevices;
    const MR = (globalThis as { MediaRecorder?: typeof MediaRecorder }).MediaRecorder;
    if (!media?.getUserMedia || !MR) {
      const reason: RecordingIssue =
        globalThis.isSecureContext === false ? "permission-denied" : "web-unsupported";
      setState("idle");
      return { ok: false, issue: reason };
    }

    try {
      const s = await media.getUserMedia({ audio: true });
      stream.current = s;

      // Web Audio Analyser for Real-Time VAD & Metering
      const AudioCtx = (globalThis as any).AudioContext || (globalThis as any).webkitAudioContext;
      if (AudioCtx) {
        try {
          const ctx = new AudioCtx();
          audioContext.current = ctx;
          if (ctx.state === "suspended") {
            ctx.resume().catch(() => {});
          }
          const src = ctx.createMediaStreamSource(s);
          const an = ctx.createAnalyser();
          an.fftSize = 256;
          an.smoothingTimeConstant = 0.25;
          src.connect(an);
          analyser.current = an;
        } catch {
          /* Fallback: recording works even without AudioContext */
        }
      }

      noiseFloor.current = 0;
      speechAccumulatedMs.current = 0;
      hasSpoken.current = false;
      lastSpeechAt.current = 0;
      silenceFired.current = false;
      const initialSilence = optionsRef.current?.silenceThresholdMs ?? 3000;
      setSilenceRemainingMs(initialSilence);

      const mimeType = pickMimeType();
      const mr = new MR(s, mimeType ? { mimeType } : undefined);
      mr.ondataavailable = (e: BlobEvent) => {
        if (e.data && e.data.size > 0) chunks.current.push(e.data);
      };
      mr.start(100);
      recorder.current = mr;

      startedAt.current = Date.now();
      setDurationMs(0);
      clearTimer();

      // Sampling loop for duration & VAD (every 80ms)
      timer.current = setInterval(() => {
        const elapsed = Date.now() - startedAt.current;
        setDurationMs(elapsed);

        if (analyser.current) {
          const buffer = new Uint8Array(analyser.current.frequencyBinCount);
          analyser.current.getByteFrequencyData(buffer);
          let sum = 0;
          for (let i = 0; i < buffer.length; i++) {
            sum += buffer[i];
          }
          const avg = sum / buffer.length;
          const normalized = Math.min(1.0, avg / 70);
          setAudioLevel(normalized);

          // Adaptive background room noise floor
          if (noiseFloor.current === 0) {
            noiseFloor.current = avg;
          } else {
            noiseFloor.current = noiseFloor.current * 0.96 + avg * 0.04;
          }

          const threshold = Math.max(9, noiseFloor.current * 1.8 + 3);
          const nowSpeaking = avg > threshold;
          setIsSpeaking(nowSpeaking);

          const silenceLimit = optionsRef.current?.silenceThresholdMs ?? 3000;
          const minSpeech = optionsRef.current?.minSpeechMs ?? 600;
          const now = Date.now();

          if (nowSpeaking) {
            speechAccumulatedMs.current += 80;
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
      }, 80);

      setState("recording");
      return { ok: true };
    } catch (err) {
      const name = (err as { name?: string })?.name ?? "";
      const reason: RecordingIssue =
        name === "NotAllowedError" || name === "SecurityError"
          ? "permission-denied"
          : "recorder-error";
      stopTracks();
      setState("idle");
      return { ok: false, issue: reason };
    }
  }, [clearTimer, stopTracks]);

  const stop = useCallback(async (): Promise<Clip> => {
    const elapsed = Date.now() - startedAt.current;
    clearTimer();
    setState("idle");

    const mr = recorder.current;
    if (!mr) {
      stopTracks();
      return { uri: null, durationMs: elapsed };
    }

    const blob = await new Promise<Blob | null>((resolve) => {
      mr.onstop = () => {
        const type = mr.mimeType || "audio/webm";
        resolve(chunks.current.length ? new Blob(chunks.current, { type }) : null);
      };
      try {
        mr.stop();
      } catch {
        resolve(null);
      }
    });

    recorder.current = null;
    stopTracks();

    if (!blob || blob.size === 0) {
      return { uri: null, durationMs: elapsed };
    }
    return { uri: URL.createObjectURL(blob), durationMs: elapsed };
  }, [clearTimer, stopTracks]);

  const cancel = useCallback(async () => {
    clearTimer();
    setDurationMs(0);
    setState("idle");
    try {
      recorder.current?.stop();
    } catch {
      /* already stopped */
    }
    recorder.current = null;
    chunks.current = [];
    stopTracks();
  }, [clearTimer, stopTracks]);

  return {
    isRecording: state === "recording",
    durationMs,
    audioLevel,
    isSpeaking,
    silenceRemainingMs,
    start,
    stop,
    cancel,
  };
}

type NativeHook = typeof import("./useVoiceRecorder").useVoiceRecorder;
const _sameShape: NativeHook = useVoiceRecorder;
void _sameShape;
