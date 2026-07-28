import * as DocumentPicker from "expo-document-picker";
import { Platform } from "react-native";
import type { BusinessAction, BusinessId, Message } from "@/types";
import { uid } from "@/utils/id";
import { ApiError, isMockMode, postForm, reportDiag } from "./client";

/**
 * Document attachments — a customer photographs an order confirmation or sends
 * a bill PDF instead of typing a reference number.
 *
 * The runtime extracts the text (pypdf / Tesseract), frames it as reference
 * material and runs it through the same resolution pipeline a typed message
 * takes, so a document produces a real receipt exactly as text does. This is
 * the WhatsApp document path (PLAN.md §3), reachable from the app and browser.
 */

/** A file chosen by the user, normalised across native and web. */
export interface PickedFile {
  /** Local file URI (native) or a blob/object URL (web). */
  uri: string;
  name: string;
  /** MIME type. Pickers lie — Android often says `application/octet-stream`. */
  type: string;
  size?: number;
  /**
   * The real `File` on web. React Native has no File, so the native path sends
   * `{uri, name, type}` instead — the two branches are not interchangeable.
   */
  file?: File;
}

export interface DocumentRequest {
  file: PickedFile;
  /** What the user typed alongside the file. Becomes their stated intent. */
  caption?: string;
  conversationId?: string;
  businessId?: BusinessId;
}

/** Matches `documents.MAX_BYTES` on the runtime — fail here rather than after the upload. */
const MAX_BYTES = 10 * 1024 * 1024;

/**
 * What the picker is allowed to return. Images and PDFs are what the runtime
 * can read; offering anything else invites a file we can only reject.
 */
const ACCEPTED_TYPES = ["application/pdf", "image/*"];

/**
 * Open the system file picker. Resolves to null when the user backs out —
 * a cancel is not an error and must not surface as one.
 */
export async function pickDocument(): Promise<PickedFile | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: ACCEPTED_TYPES,
    copyToCacheDirectory: true, // ensures a readable URI on Android content:// picks
    multiple: false,
  });

  if (result.canceled || !result.assets?.length) return null;

  const asset = result.assets[0];
  return {
    uri: asset.uri,
    name: asset.name || "document",
    type: asset.mimeType || "application/octet-stream",
    size: asset.size ?? undefined,
    // Web only: expo-document-picker hands back the DOM File, which XHR can
    // send directly. Undefined on native.
    file: (asset as { file?: File }).file,
  };
}

/** The runtime's POST /document response — ChatResponse plus what it read. */
interface RuntimeDocumentResponse {
  success?: boolean;
  conversation_id: string;
  reply_text: string;
  business_id?: string | null;
  capability?: string | null;
  receipt?: { label: string; tone?: "info" | "success" | "warning" } | null;
  state: string;
  language: string;
  /** pdf | image, or the failure reason (pdf_empty, unsupported, …). */
  document_kind?: string;
  extracted_chars?: number;
}

/** Categorise a picked file for the UI chip, using the same fallback the runtime uses. */
export function fileKind(file: PickedFile): "pdf" | "image" | "other" {
  const type = file.type.toLowerCase();
  if (type === "application/pdf") return "pdf";
  if (type.startsWith("image/")) return "image";
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "pdf") return "pdf";
  if (["png", "jpg", "jpeg", "webp", "heic", "heif", "gif", "bmp", "tif", "tiff"].includes(ext)) {
    return "image";
  }
  return "other";
}

/**
 * POST /document — upload a file, get a resolved turn back.
 *
 * Extraction plus a full resolution pass (translate → classify → act → compose)
 * is slower than a typed turn, so the budget is generous: a slow success must
 * not be reported to the customer as a failure.
 */
export async function sendDocument(req: DocumentRequest): Promise<{ message: Message }> {
  const DOCUMENT_TIMEOUT_MS = 150_000;

  if (isMockMode()) {
    return {
      message: {
        id: uid("msg"),
        role: "assistant",
        text:
          "I'm not connected to the support backend right now, so I can't read that file. " +
          "Set EXPO_PUBLIC_API_URL and restart to go live.",
        createdAt: Date.now(),
        status: "sent",
        businessId: req.businessId,
      },
    };
  }

  if (req.file.size && req.file.size > MAX_BYTES) {
    throw new ApiError(
      `That file is ${(req.file.size / 1024 / 1024).toFixed(1)} MB. Please send something under 10 MB.`,
      undefined,
      "file_too_large"
    );
  }

  const form = new FormData();
  if (Platform.OS === "web") {
    // The browser gives us a real File; anything else here uploads as "[object Object]".
    if (!req.file.file) {
      throw new ApiError("That file couldn't be read by the browser.", undefined, "no_file_handle");
    }
    form.append("file", req.file.file, req.file.name);
  } else {
    // React Native's FormData + XHR streams this natively; the DOM lib types the
    // value as Blob, hence the cast. postForm() deliberately uses XHR, not fetch.
    form.append("file", {
      uri: req.file.uri,
      name: req.file.name,
      type: req.file.type,
    } as unknown as Blob);
  }

  if (req.caption?.trim()) form.append("caption", req.caption.trim());
  if (req.conversationId) form.append("conversation_id", req.conversationId);
  if (req.businessId && req.businessId !== "generic") {
    form.append("business_id", req.businessId);
  }

  reportDiag("document.uploading", { name: req.file.name, type: req.file.type, size: req.file.size });

  let data: RuntimeDocumentResponse;
  try {
    data = await postForm<RuntimeDocumentResponse>("/document", form, DOCUMENT_TIMEOUT_MS);
  } catch (err) {
    // A 404 here is unambiguous: the runtime this build points at is older than
    // the app and has no /document route. Say that, rather than letting it read
    // as a broken file or a network fault.
    if (err instanceof ApiError && err.status === 404) {
      throw new ApiError(
        "This backend doesn't support document upload yet — it needs to be redeployed with the /document endpoint.",
        404,
        "document_endpoint_missing"
      );
    }
    throw err;
  }

  const action: BusinessAction | undefined = data.receipt
    ? { label: data.receipt.label, tone: data.receipt.tone ?? "info" }
    : undefined;

  return {
    message: {
      id: uid("msg"),
      role: "assistant",
      text: data.reply_text,
      createdAt: Date.now(),
      // An unreadable file comes back 200 with state="failed" and an
      // explanation — a normal bubble, flagged so the UI can style it.
      status: data.state === "failed" ? "error" : "sent",
      businessId: (data.business_id as BusinessId | undefined) ?? req.businessId,
      action,
    },
  };
}
