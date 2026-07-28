import type { BusinessAction, BusinessId } from "@/types";
import { ApiError, isMockMode, postForm } from "./client";

/**
 * One turn of a voice call: the caller's audio in, the resolved answer out —
 * both as text (to show) and as speech (to play).
 *
 * It is the runtime's `POST /voice`, which is `/chat` with STT in front and TTS
 * behind, so a call resolves real jobs and returns the same receipts as the app
 * and WhatsApp. `businessId` pins the turn to one merchant, exactly like a
 * business chat; omitted, the runtime routes across every manifest.
 */
export interface CallTurnRequest {
  /** Local file URI from the recorder. */
  uri: string;
  conversationId?: string;
  businessId?: BusinessId;
}

export interface CallTurnResult {
  /** What the caller said, to show immediately. */
  transcript: string;
  /** What the assistant says back. */
  reply: string;
  /** Base64 WAV of the spoken reply; empty when TTS degraded. */
  audioBase64: string;
  receipt?: BusinessAction;
  businessId?: BusinessId;
  conversationId: string;
  state: string;
  language: string;
}

interface RuntimeVoiceResponse {
  success?: boolean;
  conversation_id: string;
  reply_text: string;
  business_id?: string | null;
  receipt?: { label: string; tone?: "info" | "success" | "warning" } | null;
  state: string;
  language: string;
  transcript: string;
  detected_language: string;
  audio_base64: string;
}

/** expo-audio writes .m4a on both platforms; the engine reads the extension. */
function fileFromUri(uri: string): { uri: string; name: string; type: string } {
  const ext = (uri.split("?")[0].split(".").pop() ?? "m4a").toLowerCase();
  const mime: Record<string, string> = {
    m4a: "audio/mp4",
    mp4: "audio/mp4",
    wav: "audio/wav",
    webm: "audio/webm",
    ogg: "audio/ogg",
  };
  return { uri, name: `turn.${ext}`, type: mime[ext] ?? "application/octet-stream" };
}

export async function sendCallTurn(req: CallTurnRequest): Promise<CallTurnResult> {
  if (isMockMode()) {
    throw new ApiError(
      "Calling needs the backend. Set it in Settings → Backend, then try again.",
      undefined,
      "no_backend"
    );
  }

  const part = fileFromUri(req.uri);
  const form = new FormData();
  // React Native streams this {uri,name,type} part natively over XHR; the DOM
  // lib types the value as Blob, hence the cast. postForm() uses XHR, not fetch.
  form.append("file", part as unknown as Blob);
  if (req.conversationId) form.append("conversation_id", req.conversationId);
  if (req.businessId && req.businessId !== "generic") {
    form.append("business_id", req.businessId);
  }
  form.append("speak", "true");

  // A turn is STT → resolve → TTS; the reasoning model dominates, so allow room.
  const data = await postForm<RuntimeVoiceResponse>("/voice", form, 120_000);

  return {
    transcript: data.transcript ?? "",
    reply: data.reply_text ?? "",
    audioBase64: data.audio_base64 ?? "",
    receipt: data.receipt
      ? { label: data.receipt.label, tone: data.receipt.tone ?? "info" }
      : undefined,
    businessId: (data.business_id as BusinessId | undefined) ?? req.businessId,
    conversationId: data.conversation_id,
    state: data.state ?? "resolved",
    language: data.language ?? data.detected_language ?? "en-IN",
  };
}
