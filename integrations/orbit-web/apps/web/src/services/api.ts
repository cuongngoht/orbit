// The one HTTP client: same origin, JSON, and what every change carries -- the header the API refuses a change without,
// and this browser session's CSRF token (services/account.ts). A change may add its own headers: the version it was made
// against (`If-Match`) and, for a command that must not run twice, the key that names it (`Idempotency-Key`).
import { CSRF_HEADER, IDEMPOTENCY_HEADER, IF_MATCH_HEADER, MUTATION_HEADER, type ApiErrorBody } from "@orbit-web/contracts";
import { sessionCsrf } from "./account";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    // What the API said beside the code (a busy employee's held work, the numbers of a refusal), as it said it.
    readonly details: unknown = null,
  ) {
    super(message);
  }
}

async function parse<T>(res: Response): Promise<T> {
  const text = await res.text();
  const body = text.length > 0 ? (JSON.parse(text) as unknown) : null;
  if (res.ok) return body as T;
  const err = (body as ApiErrorBody | null)?.error;
  throw new ApiError(res.status, err?.code ?? "error", err?.message ?? `${res.status} ${res.statusText}`, err?.details ?? null);
}

export function get<T>(path: string): Promise<T> {
  return fetch(path, { headers: { accept: "application/json" }, credentials: "same-origin" }).then((r) => parse<T>(r));
}

export function send<T>(method: "POST" | "PATCH" | "PUT" | "DELETE", path: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
  const csrf = sessionCsrf();
  return fetch(path, {
    method,
    credentials: "same-origin",
    headers: { accept: "application/json", [MUTATION_HEADER]: "1", ...(csrf !== null ? { [CSRF_HEADER]: csrf } : {}), ...(body !== undefined ? { "content-type": "application/json" } : {}), ...headers },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  }).then((r) => parse<T>(r));
}

// `If-Match: "<version>"`: the version of the record the change was made against (a stale one is refused, 412).
export const ifMatch = (version: number): Record<string, string> => ({ [IF_MATCH_HEADER]: `"${version}"` });

// `Idempotency-Key: <key>`: one key per request a person means once; the same key is sent again only for the same body.
export const idempotent = (key: string): Record<string, string> => ({ [IDEMPOTENCY_HEADER]: key });

// A fresh key for a request: random, and of the shape the API accepts.
export function newIdempotencyKey(): string {
  const c = globalThis.crypto;
  if (typeof c?.randomUUID === "function") return c.randomUUID();
  const bytes = new Uint8Array(16);
  c.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export const errorText = (err: unknown): string => (err instanceof Error ? err.message : String(err));

export const errorCode = (err: unknown): string | null => (err instanceof ApiError ? err.code : null);

// The record changed since the page read it: a version the API no longer has, or a handoff that is no longer the one
// being reviewed. Never retried silently: the page offers to load the latest.
export const isStale = (err: unknown): boolean => err instanceof ApiError && (err.code === "stale_version" || err.code === "stale_handoff" || err.status === 412);
