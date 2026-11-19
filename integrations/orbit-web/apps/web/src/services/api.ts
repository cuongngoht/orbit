// The one HTTP client: same origin, JSON, and the header every change carries (the API refuses a change without it).
import { MUTATION_HEADER, type ApiErrorBody } from "@orbit-web/contracts";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

async function parse<T>(res: Response): Promise<T> {
  const text = await res.text();
  const body = text.length > 0 ? (JSON.parse(text) as unknown) : null;
  if (res.ok) return body as T;
  const err = (body as ApiErrorBody | null)?.error;
  throw new ApiError(res.status, err?.code ?? "error", err?.message ?? `${res.status} ${res.statusText}`);
}

export function get<T>(path: string): Promise<T> {
  return fetch(path, { headers: { accept: "application/json" }, credentials: "same-origin" }).then((r) => parse<T>(r));
}

export function send<T>(method: "POST" | "PATCH" | "DELETE", path: string, body?: unknown): Promise<T> {
  return fetch(path, {
    method,
    credentials: "same-origin",
    headers: { accept: "application/json", [MUTATION_HEADER]: "1", ...(body !== undefined ? { "content-type": "application/json" } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  }).then((r) => parse<T>(r));
}

export const errorText = (err: unknown): string => (err instanceof Error ? err.message : String(err));
