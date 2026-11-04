// The only network code in the packages. Two Khavion endpoints, and only when a
// key is supplied:
//   POST {base}/api/api-key/verify   body {"key": "..."}                         -> {"ok":true,"valid":true|false}
//   POST {base}/api/api-key/report   body {"key":"...","ruleIds":[...],"mode":"engineering","serviceCount":4} -> {"ok":true,"url":"..."}
// What is sent is the key, rule ids, and a count of services. Never file contents, service lists, or
// anything else from the review. The key is never logged or put in an error.

import { DEFAULT_BASE_URL } from "./constants";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type AccessOptions = {
  /** the API key; defaults to the KHAVION_API_KEY environment variable */
  key?: string;
  /** defaults to the KHAVION_BASE_URL environment variable, then https://khavion.com */
  baseUrl?: string;
  /** an alternative fetch, for tests */
  fetch?: FetchLike;
  /** per-request timeout in milliseconds (default 10000) */
  timeoutMs?: number;
};

export type ResolvedAccess = {
  key: string | null;
  /** null when a base URL was given but is not usable */
  baseUrl: string | null;
  fetch: FetchLike;
  timeoutMs: number;
};

const MAX_RESPONSE_BYTES = 64 * 1024;

function isLoopbackHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]" || hostname === "::1";
}

/** https only, except http on a loopback address (the test server). Strips any trailing slash. */
export function normalizeBaseUrl(input: string): string | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  const secure = url.protocol === "https:";
  const loopback = url.protocol === "http:" && isLoopbackHost(url.hostname);
  if (!secure && !loopback) return null;
  if (url.username || url.password) return null;
  return url.origin;
}

/** A usable key is one printable, whitespace-free token of a sane length. */
export function isPlausibleKey(key: string): boolean {
  return key.length >= 8 && key.length <= 256 && /^[\x21-\x7e]+$/.test(key);
}

export function resolveAccess(options: AccessOptions = {}): ResolvedAccess {
  const rawKey = (options.key ?? process.env.KHAVION_API_KEY ?? "").trim();
  const rawBase = (options.baseUrl ?? process.env.KHAVION_BASE_URL ?? "").trim() || DEFAULT_BASE_URL;
  return {
    key: rawKey || null,
    baseUrl: normalizeBaseUrl(rawBase),
    fetch: options.fetch ?? ((input, init) => fetch(input, init)),
    timeoutMs: options.timeoutMs ?? 10_000,
  };
}

async function postJson(
  access: ResolvedAccess,
  path: string,
  body: Record<string, unknown>,
): Promise<{ status: number; json: unknown } | null> {
  if (!access.baseUrl) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), access.timeoutMs);
  try {
    const response = await access.fetch(`${access.baseUrl}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(body),
      // A redirect would re-send the key somewhere else; refuse to follow one.
      redirect: "error",
      signal: controller.signal,
    });
    const text = await response.text();
    if (text.length > MAX_RESPONSE_BYTES) return null;
    let json: unknown = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    return { status: response.status, json };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export type KeyCheck = "valid" | "invalid" | "unreachable";

/** Ask Khavion whether a key is valid. Never throws. */
export async function verifyKey(access: ResolvedAccess): Promise<KeyCheck> {
  if (!access.key || !access.baseUrl) return "unreachable";
  if (!isPlausibleKey(access.key)) return "invalid";
  const reply = await postJson(access, "/api/api-key/verify", { key: access.key });
  if (!reply || reply.status !== 200 || typeof reply.json !== "object" || reply.json === null) return "unreachable";
  const body = reply.json as { ok?: unknown; valid?: unknown };
  if (body.ok !== true) return "unreachable";
  return body.valid === true ? "valid" : "invalid";
}

function isKhavionHost(hostname: string): boolean {
  return hostname === "khavion.com" || hostname.endsWith(".khavion.com");
}

/** Accept the link only when it is a plain web URL on the base origin or on khavion.com. */
export function acceptableReportUrl(value: unknown, baseUrl: string): string | null {
  if (typeof value !== "string" || value.length > 2048) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.username || url.password) return null;
  const sameOrigin = url.origin === baseUrl;
  const khavion = url.protocol === "https:" && isKhavionHost(url.hostname);
  return sameOrigin || khavion ? url.toString() : null;
}

/** Ask Khavion for a report link for the given rule ids. Null when none can be had. Never throws. */
export async function requestReportLink(access: ResolvedAccess, ruleIds: readonly string[], serviceCount = 0): Promise<string | null> {
  if (!access.key || !access.baseUrl || ruleIds.length === 0) return null;
  const reply = await postJson(access, "/api/api-key/report", { key: access.key, ruleIds, mode: "engineering", serviceCount });
  if (!reply || reply.status !== 200 || typeof reply.json !== "object" || reply.json === null) return null;
  const body = reply.json as { ok?: unknown; url?: unknown };
  if (body.ok !== true) return null;
  return acceptableReportUrl(body.url, access.baseUrl);
}
