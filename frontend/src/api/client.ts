import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
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

/**
 * EXPO_PUBLIC_API_URL accepts either:
 *   - a bare port, e.g. `8000` — resolved against the machine serving Metro
 *   - a full URL, e.g. `http://10.0.0.5:8000`
 *
 * Prefer the port form. A laptop's LAN IP changes every time you switch
 * network, and a stale IP in .env.local looks exactly like a broken backend.
 * Metro's host is reachable by definition — the app was downloaded from it.
 */
const RAW_BASE_URL = process.env.EXPO_PUBLIC_API_URL?.trim();

/** The host serving the JS bundle, from the Expo dev-client connection. */
function metroHost(): string | null {
  const hostUri =
    Constants.expoConfig?.hostUri ??
    (Constants.expoGoConfig as { debuggerHost?: string } | undefined)?.debuggerHost;
  const host = hostUri?.split("://").pop()?.split("/")[0]?.split(":")[0];
  return host && host !== "localhost" ? host : null;
}

function resolveBaseUrl(): string {
  if (!RAW_BASE_URL) return "http://localhost:8000";
  if (/^\d+$/.test(RAW_BASE_URL)) {
    const host = metroHost() ?? "localhost";
    return `http://${host}:${RAW_BASE_URL}`;
  }
  return RAW_BASE_URL.replace(/\/+$/, "");
}

/** What was compiled in at build time. */
export const COMPILED_BASE_URL = resolveBaseUrl();

/**
 * A backend URL set from Settings, overriding the compiled one.
 *
 * `EXPO_PUBLIC_*` is inlined when the bundle is built, so a shipped APK can
 * otherwise never be repointed — a changed backend means a full rebuild. The
 * override is read from disk once at startup and kept in memory so request
 * paths stay synchronous.
 */
const OVERRIDE_KEY = "sahayak.apiBaseUrl";
let overrideUrl: string | null = null;

/** The URL requests actually use. */
export function getApiBaseUrl(): string {
  return overrideUrl ?? COMPILED_BASE_URL;
}

export function getApiOverride(): string | null {
  return overrideUrl;
}

function normalizeUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

/** Persist an override (or clear it with null/empty). Returns what was stored. */
export async function setApiOverride(raw: string | null): Promise<string | null> {
  const url = raw ? normalizeUrl(raw) : "";
  overrideUrl = url || null;
  try {
    if (overrideUrl) await AsyncStorage.setItem(OVERRIDE_KEY, overrideUrl);
    else await AsyncStorage.removeItem(OVERRIDE_KEY);
  } catch {
    // In-memory value still applies for this session.
  }
  return overrideUrl;
}

/** Read the stored override. Call once at app start, before any request. */
export async function loadApiOverride(): Promise<string | null> {
  try {
    const stored = await AsyncStorage.getItem(OVERRIDE_KEY);
    overrideUrl = stored?.trim() ? stored.trim() : null;
  } catch {
    overrideUrl = null;
  }
  return overrideUrl;
}

/** Is the configured backend reachable? Used by the Settings "Test" button. */
export async function pingBackend(url?: string): Promise<{ ok: boolean; detail: string }> {
  const target = url ? normalizeUrl(url) : getApiBaseUrl();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(`${target}/health`, { signal: controller.signal });
    if (!response.ok) return { ok: false, detail: `HTTP ${response.status}` };
    const body = (await response.json()) as { manifests?: string[]; status?: string };
    const count = body.manifests?.length ?? 0;
    return { ok: true, detail: `${body.status ?? "ok"} · ${count} manifest${count === 1 ? "" : "s"}` };
  } catch (err) {
    const aborted = err instanceof Error && err.name === "AbortError";
    return { ok: false, detail: aborted ? "timed out" : "could not connect" };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Access token for the signed-in user, set by the auth store.
 *
 * Kept here rather than imported from the auth store so the transport has no
 * dependency on Supabase — the same reason the base URL is injectable.
 */
let authToken: string | null = null;

export function setAuthToken(token: string | null): void {
  authToken = token;
}

function authHeaders(): Record<string, string> {
  return authToken ? { Authorization: `Bearer ${authToken}` } : {};
}


export function isMockMode(): boolean {
  if (process.env.EXPO_PUBLIC_FORCE_MOCK === "1") return true;
  // An override makes us live even when nothing was compiled in — that is the
  // whole point of shipping with a placeholder.
  return !overrideUrl && !RAW_BASE_URL;
}

if (__DEV__) {
  // Env vars are inlined at bundle time, so a stale value here means the dev
  // server needs restarting — worth saying out loud rather than debugging blind.
  console.log(
    isMockMode()
      ? "[api] MOCK mode — canned replies. Set EXPO_PUBLIC_API_URL in .env.local and restart expo to go live."
      : `[api] LIVE mode → ${getApiBaseUrl()}`
  );
  // Announce ourselves to the engine log so the session is identifiable there.
  setTimeout(() => reportDiag("app.boot", { platform: Platform.OS, base: getApiBaseUrl() }), 0);
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
  /** FastAPI's error shape, which the runtime raises via HTTPException. */
  detail?: string | unknown;
}

/** The engine answers with `error.message`; the runtime with FastAPI's `detail`. */
function errorMessage(payload: EngineEnvelope | undefined, status: number): string {
  const fromEngine = payload?.error?.message;
  if (fromEngine) return fromEngine;
  if (typeof payload?.detail === "string" && payload.detail) return payload.detail;
  return `Request failed (HTTP ${status})`;
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
    throw new ApiError(errorMessage(payload, response.status), response.status, payload?.error?.code);
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
    const response = await fetch(`${getApiBaseUrl()}${path}`, {
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
        `[api] FAIL ${init.method ?? "GET"} ${getApiBaseUrl()}${path} :: ${failure.message}` +
          `${failure.status ? ` (http ${failure.status})` : ""}` +
          `${failure.code ? ` code=${failure.code}` : ""}`
      );
    }
    throw failure;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Plain GET returning parsed JSON (no engine envelope). Used for protocol
 * introspection endpoints like GET /businesses that return a bare array.
 */
export async function getJson<T>(path: string, timeoutMs = 10_000): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    // Send the session token: /history returns the signed-in user's durable
    // conversations with it, and only this process's in-memory ones without.
    const response = await fetch(`${getApiBaseUrl()}${path}`, {
      signal: controller.signal,
      headers: authHeaders(),
    });
    if (!response.ok) {
      throw new ApiError(`Request failed (HTTP ${response.status})`, response.status);
    }
    return (await response.json()) as T;
  } catch (err) {
    const failure =
      err instanceof ApiError
        ? err
        : err instanceof Error && err.name === "AbortError"
          ? new ApiError(`Request timed out after ${Math.round(timeoutMs / 1000)}s`)
          : new ApiError(err instanceof Error ? err.message : "Could not reach the backend");
    if (__DEV__) console.error(`[api] FAIL GET ${getApiBaseUrl()}${path} :: ${failure.message}`);
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
      headers: { "Content-Type": "application/json", ...authHeaders() },
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
  fetch(`${getApiBaseUrl()}/v1/_diag`, {
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
  const url = `${getApiBaseUrl()}${path}`;

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
    for (const [key, value] of Object.entries(authHeaders())) {
      xhr.setRequestHeader(key, value);
    }
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
        // Use the same extractor `parse()` does. This path previously read only
        // `error.message` (the engine's shape) and dropped FastAPI's `detail`,
        // so every runtime error arrived as a bare "Request failed (HTTP 404)"
        // — which is precisely the information needed to diagnose it.
        fail(new ApiError(errorMessage(payload, xhr.status), xhr.status, payload?.error?.code));
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
