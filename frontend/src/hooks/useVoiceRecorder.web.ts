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
export interface VoiceResult {
  uri: string | null;
  durationMs: number;
  issue?: RecordingIssue;
}

export type RecordingIssue = "permission-denied" | "web-unsupported" | "recorder-error";

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
  const [issue, setIssue] = useState<RecordingIssue | null>(null);

  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const stream = useRef<MediaStream | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedAt = useRef(0);
  const issueRef = useRef<RecordingIssue | null>(null);

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

  const flag = useCallback((reason: RecordingIssue) => {
    issueRef.current = reason;
    setIssue(reason);
  }, []);

  const start = useCallback(async () => {
    setState("requesting");
    issueRef.current = null;
    setIssue(null);
    chunks.current = [];

    const media = globalThis.navigator?.mediaDevices;
    const MR = (globalThis as { MediaRecorder?: typeof MediaRecorder }).MediaRecorder;
    // Both are absent on http:// origins other than localhost — browsers gate
    // microphone access on a secure context, so say that rather than "denied".
    if (!media?.getUserMedia || !MR) {
      flag(globalThis.isSecureContext === false ? "permission-denied" : "web-unsupported");
      setState("idle");
      return;
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
    } catch (err) {
      const name = (err as { name?: string })?.name ?? "";
      // NotAllowedError is a refusal; anything else is the device failing.
      flag(name === "NotAllowedError" || name === "SecurityError" ? "permission-denied" : "recorder-error");
      stopTracks();
      setState("idle");
    }
  }, [clearTimer, flag, stopTracks]);

  const finish = useCallback(async (): Promise<VoiceResult> => {
    const elapsed = Date.now() - startedAt.current;
    clearTimer();
    setState("idle");

    const mr = recorder.current;
    if (!mr) {
      stopTracks();
      return { uri: null, durationMs: elapsed, issue: issueRef.current ?? "recorder-error" };
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
      return { uri: null, durationMs: elapsed, issue: "recorder-error" };
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

  return {
    isRecording: state === "recording",
    isPreparing: state === "requesting",
    durationMs,
    issue,
    start,
    finish,
    cancel,
  };
}
