import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Platform } from "react-native";
import {
  AudioModule,
  RecordingPresets,
  setAudioModeAsync,
  useAudioRecorder,
} from "expo-audio";

/** Speech vs. silence, sampled from the recorder's meter. */
export interface Loudness {
  /** 0-1, for the waveform. */
  level: number;
  /** True once this turn has heard enough speech to be worth sending. */
  heardSpeech: boolean;
  /** Milliseconds of continuous silence since the last speech. */
  silentMs: number;
  /**
   * False when the device gave us no meter to read. Callers must not wait on
   * silence in that case — the silence would never arrive.
   */
  metered: boolean;
}

export interface VoiceResult {
  uri: string | null;
  durationMs: number;
  /** Why no file was produced, when `uri` is null. */
  issue?: RecordingIssue;
}

/** Why real capture was unavailable — drives an actionable message in the UI. */
export type RecordingIssue = "permission-denied" | "web-unsupported" | "recorder-error";

type RecorderState = "idle" | "requesting" | "recording";

/** How often the meter is sampled. Fast enough to feel instant, cheap enough to ignore. */
const TICK_MS = 120;

/**
 * Speech is measured against the room, not against a number.
 *
 * A fixed threshold was the bug: -40dBFS is quiet in a bedroom and loud in an
 * office, so in any room whose floor sat above it every sample counted as
 * speech, silence never arrived, and the turn never ended — the caller pauses,
 * and nothing happens.
 *
 * So each turn measures its own room for the first fraction of a second and
 * calls speech anything that rises clearly above it.
 */

/**
 * The microphone takes a moment to come up, and reports near-silence until it
 * does. Measuring the room during that window was the bug behind a turn that
 * never ended: the floor came out at the meter's ceiling, every real reading
 * sat far above it, and so every sample looked like speech forever.
 */
const WARMUP_MS = 500;

/**
 * The room's level is re-measured continuously rather than once, because
 * devices disagree wildly about what the scale even means — the same silent
 * room reads -50dB on one handset and -24dB on another. Judging each sample
 * against the recent quietest sample needs no such agreement.
 */
const FLOOR_WINDOW = 25; // ~3s of samples
const FLOOR_PERCENTILE = 0.2;

/**
 * How far above the room's own floor a sample has to sit to be a voice.
 *
 * Measured, not guessed: a quiet room on the test handset sits around -27dB and
 * drifts by up to 8, which at a smaller margin was enough to open a turn all by
 * itself and post a recording of nobody talking. A voice clears this easily.
 */
const SPEECH_MARGIN_DB = 12;

/** Consecutive loud samples that make a turn worth sending (~480ms). */
const MIN_SPEECH_TICKS = 4;

const REST: Loudness = { level: 0, heardSpeech: false, silentMs: 0, metered: false };

/**
 * Wraps expo-audio recording with a live timer and graceful fallbacks so the
 * voice flow always works in a demo — even on web or when a device denies the
 * mic. The waveform visualization is handled separately by <Waveform />.
 */
export function useVoiceRecorder() {
  // Metering is what makes a hands-free call possible: without a level to read,
  // the only way to know the caller has stopped talking is to ask them to tap.
  const recorder = useAudioRecorder({ ...RecordingPresets.HIGH_QUALITY, isMeteringEnabled: true });
  const [state, setState] = useState<RecorderState>("idle");
  const [durationMs, setDurationMs] = useState(0);
  const [issue, setIssue] = useState<RecordingIssue | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedAt = useRef(0);
  const simulated = useRef(false);
  const issueRef = useRef<RecordingIssue | null>(null);
  const [loudness, setLoudness] = useState<Loudness>(REST);
  const heard = useRef(false);
  const quietSince = useRef<number | null>(null);
  const metered = useRef(false);
  /** A rolling window of recent levels; its low end is the room. */
  const recent = useRef<number[]>([]);
  /** Ticks spent above the speech threshold, so a single spike isn't a turn. */
  const loudTicks = useRef(0);

  /**
   * Stop only if it is actually running.
   *
   * Calling stop() on an idle recorder throws, and the throw leaves expo-audio
   * believing it is still recording. That stale flag is what crashes the app:
   * when Android backgrounds the activity, expo-audio pauses every "recording"
   * recorder, and MediaRecorder.pause() on one that isn't recording is a native
   * IllegalStateException — which takes the whole process down, not just the
   * call.
   */
  const safeStop = useCallback(async () => {
    try {
      if (recorder.isRecording) await recorder.stop();
    } catch (err) {
      if (__DEV__) console.warn(`[recorder] stop failed: ${String(err)}`);
    }
  }, [recorder]);

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

  /**
   * Close the mic when the app leaves the foreground.
   *
   * Belt and braces against the same crash: getting the recorder genuinely
   * stopped means expo-audio's background handler has nothing to pause. A call
   * doesn't survive being backgrounded anyway — there is no foreground service
   * behind it — so ending the capture is also the honest behaviour.
   */
  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "active") return;
      clearTimer();
      setState("idle");
      void safeStop();
    });
    return () => sub.remove();
  }, [clearTimer, safeStop]);

  const beginTimer = useCallback(() => {
    startedAt.current = Date.now();
    setDurationMs(0);
    heard.current = false;
    quietSince.current = null;
    setLoudness(REST);
    metered.current = false;
    recent.current = [];
    loudTicks.current = 0;
    clearTimer();
    timer.current = setInterval(() => {
      const now = Date.now();
      setDurationMs(now - startedAt.current);

      // A simulated capture has no meter; leave the loudness at rest so the
      // caller's silence detector never fires on a mic that isn't recording.
      if (simulated.current) return;

      // expo-audio reports dBFS: roughly -160 (silent) to 0 (clipping). Not
      // every device provides it, and a caller that waits for silence it can
      // never observe would hold the mic open forever — so say when it's absent
      // rather than looking like an endless quiet room.
      let db: number | undefined;
      try {
        db = recorder.getStatus?.().metering;
      } catch {
        db = undefined;
      }
      if (typeof db !== "number") {
        setLoudness((prev) => (prev.metered ? { ...prev, metered: false } : prev));
        return;
      }
      metered.current = true;
      const level = Math.max(0, Math.min(1, (db + 60) / 60));
      const elapsed = now - startedAt.current;

      // Let the mic come up before believing anything it says.
      if (elapsed < WARMUP_MS) {
        setLoudness({ level, heardSpeech: false, silentMs: 0, metered: true });
        return;
      }

      recent.current.push(db);
      if (recent.current.length > FLOOR_WINDOW) recent.current.shift();

      const sorted = [...recent.current].sort((a, b) => a - b);
      const floorDb = sorted[Math.floor(sorted.length * FLOOR_PERCENTILE)];

      if (db > floorDb + SPEECH_MARGIN_DB) {
        // A door closing is one loud tick. A word is several. Requiring a run
        // of them keeps a turn from being built out of a single bang.
        loudTicks.current += 1;
        if (loudTicks.current >= MIN_SPEECH_TICKS) heard.current = true;
        quietSince.current = null;
      } else {
        loudTicks.current = 0;
        if (quietSince.current === null) quietSince.current = now;
      }

      setLoudness({
        level,
        heardSpeech: heard.current,
        silentMs: quietSince.current === null ? 0 : now - quietSince.current,
        metered: true,
      });
    }, TICK_MS);
  }, [clearTimer, recorder]);

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
      try {
        await recorder.prepareToRecordAsync();
        recorder.record();
      } catch (first) {
        // The previous turn's recorder can still be tearing down when the next
        // one opens — a hands-free call starts them back to back. One retry
        // after a beat is the difference between a call that keeps going and
        // one that goes deaf after the first answer.
        if (__DEV__) console.warn(`[recorder] retrying start: ${String(first)}`);
        await new Promise((r) => setTimeout(r, 250));
        await recorder.prepareToRecordAsync();
        recorder.record();
      }
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
      await safeStop();
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
  }, [clearTimer, recorder, safeStop]);

  const cancel = useCallback(async () => {
    clearTimer();
    setState("idle");
    setDurationMs(0);
    if (!simulated.current) await safeStop();
  }, [clearTimer, safeStop]);

  return {
    isRecording: state === "recording",
    isPreparing: state === "requesting",
    durationMs,
    /** Live mic level + silence run, for the waveform and the end-of-turn call. */
    loudness,
    /** Non-null when the mic isn't actually capturing — surface it, don't fake it. */
    issue,
    start,
    finish,
    cancel,
  };
}
