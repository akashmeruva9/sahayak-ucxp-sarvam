import { useEffect, useRef, useState } from 'react';
import { Spinner } from './Primitives';

/** Below this there is no speech in the file, only a container header. */
const MIN_MS = 900;
/** Nobody means to record for a minute. Stop rather than upload a huge file. */
const MAX_MS = 60_000;
/** Peak level below which the track carried no voice, only a noise floor. */
const SILENCE = 0.02;

/** Records one answer, hands the audio up, and gets out of the way.
 *
 * Click to start, click to stop. Push-to-talk was tried first and was the wrong
 * choice: it is invisible unless you already know the convention, and because
 * the microphone permission prompt appears *during* the press, the very first
 * attempt is a press whose release lands somewhere the recorder cannot hear it.
 * A toggle has one meaning, survives the permission dialog, and reads the same
 * to someone who has never used the product.
 *
 * This component owns the microphone and nothing else. It never decides what
 * the fields mean; it returns a Blob and lets the section fill itself in, so
 * the merchant's own edits always win.
 */
export default function MicButton({ onResult, busy = false, disabled = false, label }) {
  const [recording, setRecording] = useState(false);
  const [level, setLevel] = useState(0);
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState('');
  // What the last recording actually contained. Shown because "it didn't work"
  // is unactionable: a loud recording that yields no transcript is a different
  // problem from one that captured a whisper, and only this tells them apart.
  const [reading, setReading] = useState(null);

  const recorder = useRef(null);
  const chunks = useRef([]);
  const stream = useRef(null);
  const audioCtx = useRef(null);
  const frame = useRef(0);
  const startedAt = useRef(0);
  const ticker = useRef(0);
  const autoStop = useRef(0);
  const starting = useRef(false);
  // Loudest thing the microphone heard this recording. A track that stays at
  // zero is a device problem, and it is worth saying so rather than sending
  // silence to Saaras and reporting back whatever it guesses from nothing.
  const peak = useRef(0);
  const metered = useRef(false);

  // A merchant who navigates away mid-sentence must not leave the browser's
  // recording indicator lit. Every exit path -- stop, error, unmount -- comes
  // through here, so the microphone is released exactly once.
  const teardown = () => {
    cancelAnimationFrame(frame.current);
    clearInterval(ticker.current);
    clearTimeout(autoStop.current);
    if (audioCtx.current) {
      audioCtx.current.close().catch(() => {});
      audioCtx.current = null;
    }
    if (stream.current) {
      stream.current.getTracks().forEach((track) => track.stop());
      stream.current = null;
    }
    setLevel(0);
  };

  useEffect(() => teardown, []);

  const stop = () => {
    if (recorder.current?.state === 'recording') recorder.current.stop();
  };

  const start = async () => {
    if (recording || busy || disabled || starting.current) return;
    setError('');

    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setError('This browser cannot record audio. Please type your details in below.');
      return;
    }

    starting.current = true;
    let media;
    try {
      media = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      starting.current = false;
      // Denied, dismissed, or no microphone at all. Each needs its own sentence,
      // because "allow the microphone" is useless advice to someone without one.
      setError(
        err?.name === 'NotAllowedError'
          ? 'Microphone access was blocked. Allow it in your browser, then click again.'
          : err?.name === 'NotFoundError'
            ? 'No microphone found. Please type your details in below.'
            : 'Could not start recording. Please type your details in below.',
      );
      return;
    }

    stream.current = media;
    chunks.current = [];
    peak.current = 0;
    metered.current = false;
    setReading(null);

    // A level meter, not a waveform: the merchant needs to see that we can hear
    // them. Silence that looks identical to speech is the fastest way to lose
    // their trust in the feature.
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      ctx.createMediaStreamSource(media).connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      audioCtx.current = ctx;

      metered.current = true;
      const tick = () => {
        analyser.getByteFrequencyData(data);
        const mean = data.reduce((sum, v) => sum + v, 0) / data.length;
        const now = Math.min(1, mean / 90);
        if (now > peak.current) peak.current = now;
        setLevel(now);
        frame.current = requestAnimationFrame(tick);
      };
      tick();
    } catch {
      // Metering is a nicety, and without it we simply cannot make the silence
      // claim below -- so record that, rather than reporting a silent mic on a
      // browser where we never measured one.
      metered.current = false;
    }

    const mime = ['audio/webm', 'audio/mp4'].find(
      (type) => MediaRecorder.isTypeSupported?.(type),
    );
    const rec = new MediaRecorder(media, mime ? { mimeType: mime } : undefined);
    recorder.current = rec;

    rec.ondataavailable = (event) => {
      if (event.data?.size) chunks.current.push(event.data);
    };
    rec.onstop = () => {
      const held = Date.now() - startedAt.current;
      // Sarvam's docs list "audio/webm"; MediaRecorder appends ";codecs=opus",
      // which the bare type does not need.
      const isMp4 = rec.mimeType?.includes('mp4');
      const blob = new Blob(chunks.current, { type: isMp4 ? 'audio/mp4' : 'audio/webm' });
      teardown();
      setRecording(false);
      setSeconds(0);
      setReading({
        secs: (held / 1000).toFixed(1),
        peak: Math.round(peak.current * 100),
        kb: Math.round(blob.size / 1024),
        metered: metered.current,
      });

      // Stopping straight away yields a container header and no speech. That is
      // several hundred bytes, so it would upload happily, and Saaras would
      // answer with an empty transcript -- sending the merchant off to find a
      // quieter room to fix a problem that was never about noise.
      if (held < MIN_MS || !blob.size) {
        setError('That was too short. Click Start, say your sentence, then click Stop.');
        return;
      }

      // The track ran, and never rose above the noise floor. Uploading this
      // wastes a round trip and comes back as "we couldn't make out any
      // speech", which sends the merchant to find a quieter room -- when the
      // truth is their browser is listening to the wrong device, or to one that
      // is muted. Name that instead.
      if (metered.current && peak.current < SILENCE) {
        setError('We could not hear your microphone. Check the input device in your '
                 + 'browser — click the 🎙 icon in the address bar — then try again.');
        return;
      }
      onResult(blob, isMp4 ? 'speech.mp4' : 'speech.webm');
    };

    // A timeslice makes ondataavailable fire while recording rather than only
    // at stop, so even a brief answer carries real audio frames.
    rec.start(250);
    startedAt.current = Date.now();
    starting.current = false;
    setRecording(true);
    setSeconds(0);
    ticker.current = setInterval(
      () => setSeconds(Math.floor((Date.now() - startedAt.current) / 1000)), 250);
    autoStop.current = setTimeout(stop, MAX_MS);
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          data-testid="mic-button"
          data-recording={String(recording)}
          disabled={disabled || busy}
          onClick={recording ? stop : start}
          className={`ucxp-press flex select-none items-center gap-2 rounded-btn border
                      px-3.5 py-2 text-[13px] font-medium transition-colors
                      ${recording ? 'border-ink bg-surface' : 'border-line bg-canvas hover:bg-surface'}
                      ${disabled || busy ? 'cursor-not-allowed opacity-60' : ''}`}
        >
          {busy ? <Spinner /> : <span aria-hidden="true">{recording ? '⏹' : '🎙'}</span>}
          {busy ? 'Listening…' : recording ? `Stop · ${seconds}s` : label}
        </button>

        {recording && (
          <>
            <span
              className="h-1.5 w-24 overflow-hidden rounded-full bg-surface"
              data-testid="mic-level"
              aria-hidden="true"
            >
              <span
                className="block h-full rounded-full bg-ink transition-[width] duration-75"
                style={{ width: `${Math.round(level * 100)}%` }}
              />
            </span>
            <span className="text-xs text-ink-muted" data-testid="mic-hint">
              Speak now, then click Stop
            </span>
          </>
        )}
      </div>

      {reading && !recording && (
        <p className="text-xs text-ink-faint" data-testid="mic-reading">
          Recorded {reading.secs}s · {reading.kb} KB ·{' '}
          {reading.metered ? `loudest ${reading.peak}%` : 'level not measurable'}
          {reading.metered && reading.peak < 15 && (
            <span className="text-err">
              {' '}— that is very quiet. Your browser is probably listening to the
              wrong microphone.
            </span>
          )}
        </p>
      )}

      {error && (
        <p className="text-xs text-err" data-testid="mic-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
