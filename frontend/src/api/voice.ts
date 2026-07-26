import { ApiError, isMockMode, networkDelay, postForm, reportDiag } from "./client";

export interface VoiceRequest {
  /** Local file URI produced by the recorder (or null in mock mode). */
  uri: string | null;
  durationMs: number;
  /** Why `uri` is null, when the recorder couldn't capture. Diagnostics only. */
  issue?: string;
}

export interface VoiceResponse {
  /** The transcribed text, ready to be fed into the chat pipeline. */
  transcript: string;
}

/**
 * A rotating set of plausible transcripts so demos feel alive. Replaces the
 * future speech-to-text step of POST /voice.
 */
const MOCK_TRANSCRIPTS = [
  "Where is my Flipkart order?",
  "I want to cancel my Airtel Fiber connection",
  "Book me a doctor's appointment at Apollo tomorrow",
  "Raise a complaint about a wrong charge on my HDFC card",
  "What's the status of my Swiggy order?",
  "Is my train ticket confirmed?",
];

/**
 * Sarvam's realtime speech-to-text hard-caps at 30 s — longer audio needs their
 * batch API — so an over-long recording is rejected here instead of after a
 * wasted upload. See PLAN.md §3.1.
 */
const MAX_CLIP_MS = 30_000;

function mockTranscript(): VoiceResponse {
  return {
    transcript: MOCK_TRANSCRIPTS[Math.floor(Math.random() * MOCK_TRANSCRIPTS.length)],
  };
}

/**
 * expo-audio yields .m4a on Android and iOS. Sarvam accepts it (verified
 * against the live API), and the engine derives the content type from the
 * filename, so keeping the real extension matters.
 */
function fileFromUri(uri: string): { uri: string; name: string; type: string } {
  const extension = (uri.split("?")[0].split(".").pop() ?? "m4a").toLowerCase();
  const mime: Record<string, string> = {
    m4a: "audio/mp4",
    mp4: "audio/mp4",
    wav: "audio/wav",
    mp3: "audio/mpeg",
    webm: "audio/webm",
    ogg: "audio/ogg",
    caf: "audio/x-caf",
  };
  return {
    uri,
    name: `recording.${extension}`,
    type: mime[extension] ?? "application/octet-stream",
  };
}

interface EngineSpeechResponse {
  success: boolean;
  transcript: string;
  detected_language: string;
}

/** POST /voice — uploads audio, returns a transcript. */
export async function transcribeVoice(req: VoiceRequest): Promise<VoiceResponse> {
  if (__DEV__) {
    console.log(
      `[voice] mock=${isMockMode()} uri=${req.uri ?? "NULL (no recording captured)"} ` +
        `durationMs=${req.durationMs}`
    );
  }
  reportDiag("voice.attempt", {
    uri: req.uri ?? "NULL",
    durationMs: req.durationMs,
    issue: req.issue ?? "none",
  });

  if (isMockMode()) {
    await networkDelay(700, 1400);
    return mockTranscript();
  }

  // Live, but the recorder produced no file: it fell back to a simulated
  // capture because the mic was denied or we're on web (useVoiceRecorder bails
  // on `Platform.OS === "web"`). Say so loudly — silently returning a canned
  // transcript here makes a broken mic look like a working demo.
  if (!req.uri) {
    reportDiag("voice.no_audio", { issue: req.issue ?? "unknown" });
    throw new ApiError(
      "No audio was captured — the microphone was denied, or you're running on web, " +
        "where recording is disabled. Try an iOS/Android device or simulator.",
      undefined,
      "no_audio_captured"
    );
  }

  if (req.durationMs > MAX_CLIP_MS) {
    throw new ApiError(
      `That recording is ${Math.round(req.durationMs / 1000)}s long. Please keep it under 30 seconds.`,
      undefined,
      "audio_too_long"
    );
  }

  const part = fileFromUri(req.uri);
  const form = new FormData();
  // React Native's FormData + XHR streams this natively; the DOM lib types the
  // value as Blob, hence the cast. postForm() deliberately uses XHR, not fetch.
  form.append("file", part as unknown as Blob);
  reportDiag("voice.uploading", { name: part.name, type: part.type });

  const data = await postForm<EngineSpeechResponse>("/v1/transcribe", form);
  return { transcript: data.transcript };
}
