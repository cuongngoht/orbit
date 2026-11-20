// The one HTTP client: same origin, JSON, and the header every change carries (the API refuses a change without it) --
// and, once an operator signed in to governance here, that session's CSRF token (services/operator.ts).
import { MUTATION_HEADER, OPERATOR_CSRF_HEADER, type ApiErrorBody } from "@orbit-web/contracts";
import { operatorCsrf } from "./operator";

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

export function send<T>(method: "POST" | "PATCH" | "PUT" | "DELETE", path: string, body?: unknown): Promise<T> {
  const csrf = operatorCsrf();
  return fetch(path, {
    method,
    credentials: "same-origin",
    headers: { accept: "application/json", [MUTATION_HEADER]: "1", ...(csrf !== null ? { [OPERATOR_CSRF_HEADER]: csrf } : {}), ...(body !== undefined ? { "content-type": "application/json" } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  }).then((r) => parse<T>(r));
}

export const errorText = (err: unknown): string => (err instanceof Error ? err.message : String(err));
