import { useEffect, useRef, useState } from 'react';
import { Spinner } from './Primitives';

/** Records one answer, hands the audio up, and gets out of the way.
 *
 * Press and hold to talk, release to send — the same gesture as a voice note,
 * which is the one recording interaction a merchant already knows. There is no
 * transport state to reason about and no way to leave a recording running by
 * accident.
 *
 * This component owns the microphone and nothing else. It never decides what
 * the fields mean; it returns a Blob and lets the section fill itself in, so
 * the merchant's own edits always win.
 */
export default function MicButton({ onResult, busy = false, disabled = false, label }) {
  const [recording, setRecording] = useState(false);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState('');

  const recorder = useRef(null);
  const chunks = useRef([]);
  const stream = useRef(null);
  const audioCtx = useRef(null);
  const frame = useRef(0);

  // A merchant who navigates away mid-sentence must not leave the browser's
  // recording indicator lit. This is the only place the tracks are stopped, so
  // every exit path — release, error, unmount — comes through it.
  const teardown = () => {
    cancelAnimationFrame(frame.current);
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

  const start = async () => {
    if (recording || busy || disabled) return;
    setError('');

    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setError('This browser cannot record audio. Please type your details in below.');
      return;
    }

    let media;
    try {
      media = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      // Denied, dismissed, or no microphone at all. Each needs a different
      // sentence, because "allow the microphone" is useless advice to someone
      // who does not have one.
      setError(
        err?.name === 'NotAllowedError'
          ? 'Microphone access was blocked. Allow it in your browser, or type your details in below.'
          : err?.name === 'NotFoundError'
            ? 'No microphone found. Please type your details in below.'
            : 'Could not start recording. Please type your details in below.',
      );
      return;
    }

    stream.current = media;
    chunks.current = [];

    // A level meter, not a waveform: the merchant needs to know we can hear
    // them, and silence that looks identical to speech is the fastest way to
    // lose their trust in the feature.
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      ctx.createMediaStreamSource(media).connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      audioCtx.current = ctx;

      const tick = () => {
        analyser.getByteFrequencyData(data);
        const mean = data.reduce((sum, v) => sum + v, 0) / data.length;
        setLevel(Math.min(1, mean / 90));
        frame.current = requestAnimationFrame(tick);
      };
      tick();
    } catch {
      // Metering is a nicety. Losing it must not cost the merchant the feature.
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
      const blob = new Blob(chunks.current, { type: rec.mimeType || 'audio/webm' });
      teardown();
      setRecording(false);
      if (blob.size) {
        onResult(blob, rec.mimeType?.includes('mp4') ? 'speech.mp4' : 'speech.webm');
      }
    };

    rec.start();
    setRecording(true);
  };

  const stop = () => {
    if (recorder.current?.state === 'recording') recorder.current.stop();
  };

  const active = recording || busy;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          data-testid="mic-button"
          data-recording={String(recording)}
          disabled={disabled || busy}
          aria-label={recording ? 'Recording — release to finish' : label}
          onPointerDown={start}
          onPointerUp={stop}
          onPointerLeave={stop}
          // Keyboard parity: space and enter hold while pressed, like the pointer.
          onKeyDown={(e) => {
            if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) {
              e.preventDefault();
              start();
            }
          }}
          onKeyUp={(e) => {
            if (e.key === ' ' || e.key === 'Enter') {
              e.preventDefault();
              stop();
            }
          }}
          className={`ucxp-press flex select-none items-center gap-2 rounded-btn border
                      px-3.5 py-2 text-[13px] font-medium transition-colors
                      ${recording ? 'border-ink bg-surface' : 'border-line bg-canvas hover:bg-surface'}
                      ${disabled || busy ? 'cursor-not-allowed opacity-60' : ''}`}
        >
          {busy ? <Spinner /> : <span aria-hidden="true">🎙</span>}
          {busy ? 'Listening…' : recording ? 'Release to finish' : label}
        </button>

        {recording && (
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
        )}
      </div>

      {error && (
        <p className="text-xs text-err" data-testid="mic-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
