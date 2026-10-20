// The one door to the Control Server. Feature code asks `api.get/post/put/delete`
// and never writes fetch() itself: JSON in and out, every failure normalised
// into an ApiError, and the mutation token attached to every change.
//
// The token arrives once, in the URL's #fragment (control-server prints it).
// It is moved into sessionStorage -- this tab only, gone when the tab closes --
// and wiped from the address bar, so it is not left in history or on screen.

export const TOKEN_HEADER = "x-orbit-control-token";
const TOKEN_KEY = "orbit.control.token";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: string[];

  constructor(status: number, code: string, message: string, details: string[] = []) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function adoptTokenFromUrl(): void {
  const token = new URLSearchParams(window.location.hash.slice(1)).get("token");
  if (!token) return;
  window.sessionStorage.setItem(TOKEN_KEY, token);
  window.history.replaceState(null, "", window.location.pathname + window.location.search);
}

export const mutationToken = (): string | null => window.sessionStorage.getItem(TOKEN_KEY);

type Method = "GET" | "POST" | "PUT" | "DELETE";

async function request<T>(method: Method, path: string, body?: unknown): Promise<T> {
  const response = await send(method, path, body);
  const payload: unknown = await parsed(response);
  if (!response.ok) throw failureOf(response.status, payload);
  return payload as T;
}

function headersFor(method: Method, body: unknown): Record<string, string> {
  const headers: Record<string, string> = { accept: "application/json" };
  if (body !== undefined) headers["content-type"] = "application/json";
  const token = method === "GET" ? null : mutationToken();
  if (token) headers[TOKEN_HEADER] = token;
  return headers;
}

async function send(method: Method, path: string, body: unknown): Promise<Response> {
  try {
    return await fetch(path, { method, headers: headersFor(method, body), body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiError(0, "NETWORK_ERROR", "The Orbit Control server could not be reached. Is it still running?");
  }
}

async function parsed(response: Response): Promise<unknown> {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

interface ErrorPayload {
  error?: { code?: string; message?: string; details?: string[] };
}

function failureOf(status: number, payload: unknown): ApiError {
  const error = (payload as ErrorPayload | null)?.error;
  return new ApiError(status, error?.code ?? `HTTP_${status}`, error?.message ?? `The server answered ${status}.`, error?.details ?? []);
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body),
  put: <T>(path: string, body: unknown) => request<T>("PUT", path, body),
  delete: <T>(path: string) => request<T>("DELETE", path),
};
