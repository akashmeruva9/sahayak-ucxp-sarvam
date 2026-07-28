import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Web microphone capture — the browser can do this perfectly well; it is
 * `expo-audio` that has no web recorder, which is why the native hook falls
 * back to a simulated clip here.
 *
 * Same shape as `useVoiceRecorder.ts` so every caller (VoiceOverlay, CallScreen)
 * works unchanged; Metro picks this file on web automatically.
 *
 * `getUserMedia` triggers the browser's own permission prompt, and a refusal is
 * reported as `permission-denied` rather than silently producing nothing.
 */
export type RecordingIssue = "permission-denied" | "web-unsupported" | "recorder-error";

/**
 * Deliberately identical to `useVoiceRecorder.ts`. Metro swaps the two by
 * filename, so nothing at the call site knows which one it got — and when the
 * native hook's surface changed and this one didn't, every caller on web threw
 * "stop is not a function" the moment someone pressed the button. The two files
 * are one contract with two implementations.
 */
export interface StartResult {
  ok: boolean;
  issue?: RecordingIssue;
}

export interface Clip {
  uri: string | null;
  durationMs: number;
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

export function useVoiceRecorder() {
  const [state, setState] = useState<RecorderState>("idle");
  const [durationMs, setDurationMs] = useState(0);

  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const stream = useRef<MediaStream | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedAt = useRef(0);

  const clearTimer = useCallback(() => {
    if (timer.current) {
      clearInterval(timer.current);
      timer.current = null;
    }
  }, []);

  /** Release the mic so the browser's recording indicator goes away. */
  const stopTracks = useCallback(() => {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
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
    // Both are absent on http:// origins other than localhost — browsers gate
    // microphone access on a secure context, so say that rather than "denied".
    if (!media?.getUserMedia || !MR) {
      const reason: RecordingIssue =
        globalThis.isSecureContext === false ? "permission-denied" : "web-unsupported";
      setState("idle");
      return { ok: false, issue: reason };
    }

    try {
      // This is the call that raises the browser's permission prompt.
      const s = await media.getUserMedia({ audio: true });
      stream.current = s;

      const mimeType = pickMimeType();
      const mr = new MR(s, mimeType ? { mimeType } : undefined);
      mr.ondataavailable = (e: BlobEvent) => {
        if (e.data && e.data.size > 0) chunks.current.push(e.data);
      };
      mr.start();
      recorder.current = mr;

      startedAt.current = Date.now();
      setDurationMs(0);
      clearTimer();
      timer.current = setInterval(() => setDurationMs(Date.now() - startedAt.current), 100);

      setState("recording");
      return { ok: true };
    } catch (err) {
      const name = (err as { name?: string })?.name ?? "";
      // NotAllowedError is a refusal; anything else is the device failing.
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

    // `stop()` is async — the final chunk only lands on the stop event.
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
    // A blob: URL keeps the caller's contract identical to native, where the
    // recorder hands back a file URI. The upload layer resolves it back.
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

  return { isRecording: state === "recording", durationMs, start, stop, cancel };
}

/**
 * The two implementations are one contract.
 *
 * Metro chooses between this file and `useVoiceRecorder.ts` by filename, so no
 * caller can tell them apart — and nothing checked that they matched. When the
 * native hook was rewritten and this one was not, `stop` simply did not exist
 * on web: pressing the button threw "is not a function" at the customer, with
 * the mic already running.
 *
 * This makes that a build error instead. It costs nothing at runtime — a type
 * assignment the bundler drops.
 */
type NativeHook = typeof import("./useVoiceRecorder").useVoiceRecorder;
const _sameShape: NativeHook = useVoiceRecorder;
void _sameShape;
