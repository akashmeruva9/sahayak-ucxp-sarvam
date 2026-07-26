import { Platform } from "react-native";

/**
 * Transport for the API layer. Every endpoint routes through here so that
 * swapping backends is a one-file change. The public API of each module
 * (chat/voice/history) stays identical whether we're mocked or live.
 *
 * Live mode talks to the **AI Engine** (`ai_engine.app`) directly. That is an
 * interim arrangement — see PLAN.md §7 decision 13. Once the UCXP Runtime
 * exists, only `API_BASE_URL` changes: the runtime exposes POST /chat + /voice
 * and adds business routing, receipts and memory on top of the same engine.
 *
 * Mock is the default. Live is opt-in via EXPO_PUBLIC_API_URL, so a missing
 * backend degrades to the scripted demo instead of a broken screen.
 */

/** Set e.g. EXPO_PUBLIC_API_URL=http://192.168.1.5:8080 — a LAN IP, not localhost, for devices. */
const RAW_BASE_URL = process.env.EXPO_PUBLIC_API_URL?.trim();

export const API_BASE_URL = (RAW_BASE_URL || "http://localhost:8080").replace(/\/+$/, "");

/** Simulate realistic, slightly variable network latency. */
export function networkDelay(min = 550, max = 1200): Promise<void> {
  const ms = min + Math.random() * (max - min);
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isMockMode(): boolean {
  if (process.env.EXPO_PUBLIC_FORCE_MOCK === "1") return true;
  return !RAW_BASE_URL;
}

if (__DEV__) {
  // Env vars are inlined at bundle time, so a stale value here means the dev
  // server needs restarting — worth saying out loud rather than debugging blind.
  console.log(
    isMockMode()
      ? "[api] MOCK mode — canned replies. Set EXPO_PUBLIC_API_URL in .env.local and restart expo to go live."
      : `[api] LIVE mode → ${API_BASE_URL}`
  );
  // Announce ourselves to the engine log so the session is identifiable there.
  setTimeout(() => reportDiag("app.boot", { platform: Platform.OS, base: API_BASE_URL }), 0);
}

/** A failure from the backend, carrying the engine's structured error code. */
export class ApiError extends Error {
  readonly status?: number;
  readonly code?: string;

  constructor(message: string, status?: number, code?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

/**
 * The engine never throws — it answers with `success: false` and a structured
 * `error`, usually on a 4xx/5xx. Both shapes are normalised into ApiError here
 * so callers only ever see a resolved value or an ApiError.
 */
interface EngineEnvelope {
  success?: boolean;
  error?: { message?: string; code?: string; stage?: string } | null;
}

async function parse<T extends EngineEnvelope>(response: Response): Promise<T> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new ApiError(
      `Backend returned a non-JSON response (HTTP ${response.status})`,
      response.status
    );
  }

  const payload = body as T;
  if (!response.ok || payload?.success === false) {
    const error = payload?.error;
    throw new ApiError(
      error?.message ?? `Request failed (HTTP ${response.status})`,
      response.status,
      error?.code
    );
  }
  return payload;
}

async function send<T extends EngineEnvelope>(
  path: string,
  init: RequestInit,
  timeoutMs: number
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      signal: controller.signal,
    });
    return await parse<T>(response);
  } catch (err) {
    const failure =
      err instanceof ApiError
        ? err
        : err instanceof Error && err.name === "AbortError"
          ? new ApiError(`Request timed out after ${Math.round(timeoutMs / 1000)}s`)
          : new ApiError(err instanceof Error ? err.message : "Could not reach the backend");

    if (__DEV__) {
      console.error(
        `[api] FAIL ${init.method ?? "GET"} ${API_BASE_URL}${path} :: ${failure.message}` +
          `${failure.status ? ` (http ${failure.status})` : ""}` +
          `${failure.code ? ` code=${failure.code}` : ""}`
      );
    }
    throw failure;
  } finally {
    clearTimeout(timer);
  }
}

/** The reasoning model thinks before it answers, so allow a generous budget. */
export function postJson<T extends EngineEnvelope>(
  path: string,
  body: unknown,
  timeoutMs = 45_000
): Promise<T> {
  return send<T>(
    path,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    timeoutMs
  );
}

/**
 * Fire-and-forget diagnostic ping so device-side events land in the engine's
 * log, which is far easier to read than a phone's console. Dev + live only,
 * and it can never break a real flow: failures are swallowed deliberately.
 */
export function reportDiag(event: string, data: Record<string, unknown> = {}): void {
  if (!__DEV__ || isMockMode()) return;
  fetch(`${API_BASE_URL}/v1/_diag`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ event, ...data }),
  }).catch(() => {
    /* diagnostics must never surface as an app error */
  });
}

/**
 * Multipart upload over XMLHttpRequest rather than fetch — deliberately.
 *
 * Expo SDK 57's global fetch is WinterCG-compliant and rejects React Native's
 * `{uri, name, type}` FormData part ("Unsupported FormDataPart implementation").
 * Its supported alternatives (Blob / an object with bytes()) mean reading the
 * whole file into JS memory, and on a bare workflow that needs a native module
 * the existing dev build doesn't have. React Native's own XHR networking
 * accepts the URI part and streams the file natively — no rebuild, no copy.
 */
export function postForm<T extends EngineEnvelope>(
  path: string,
  form: FormData,
  timeoutMs = 60_000
): Promise<T> {
  const url = `${API_BASE_URL}${path}`;

  return new Promise<T>((resolve, reject) => {
    const fail = (error: ApiError) => {
      if (__DEV__) {
        console.error(
          `[api] FAIL POST ${url} :: ${error.message}` +
            `${error.status ? ` (http ${error.status})` : ""}` +
            `${error.code ? ` code=${error.code}` : ""}`
        );
      }
      reject(error);
    };

    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.timeout = timeoutMs;
    // Content-Type is intentionally unset: RN fills in the multipart boundary.

    xhr.onload = () => {
      let payload: T;
      try {
        payload = JSON.parse(xhr.responseText) as T;
      } catch {
        fail(new ApiError(`Backend returned a non-JSON response (HTTP ${xhr.status})`, xhr.status));
        return;
      }
      if (xhr.status >= 400 || payload?.success === false) {
        fail(
          new ApiError(
            payload?.error?.message ?? `Request failed (HTTP ${xhr.status})`,
            xhr.status,
            payload?.error?.code
          )
        );
        return;
      }
      resolve(payload);
    };
    xhr.onerror = () => fail(new ApiError("Could not reach the backend"));
    xhr.ontimeout = () =>
      fail(new ApiError(`Request timed out after ${Math.round(timeoutMs / 1000)}s`));

    xhr.send(form);
  });
}
