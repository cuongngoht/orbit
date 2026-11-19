// A fetch for tests: routes "METHOD /path" to handlers and records every call. A handler returns the JSON body (200),
// or `withStatus(code, body)` for anything else.
import { vi } from "vitest";

export class WithStatus {
  constructor(
    readonly status: number,
    readonly body: unknown,
  ) {}
}

export const withStatus = (status: number, body?: unknown): WithStatus => new WithStatus(status, body);

export type Handler = (body: unknown, url: URL) => unknown;

export interface FakeApi {
  calls: { method: string; path: string; body: unknown; headers: Record<string, string> }[];
  on(method: string, path: string | RegExp, handler: Handler): FakeApi;
}

export function fakeApi(): FakeApi {
  const routes: { method: string; path: string | RegExp; handler: Handler }[] = [];
  const api: FakeApi = {
    calls: [],
    on(method, path, handler) {
      routes.unshift({ method, path, handler });
      return api;
    },
  };
  vi.stubGlobal("fetch", async (input: string, init: RequestInit = {}) => {
    const url = new URL(input, "http://localhost");
    const method = (init.method ?? "GET").toUpperCase();
    const body = typeof init.body === "string" ? (JSON.parse(init.body) as unknown) : undefined;
    api.calls.push({ method, path: `${url.pathname}${url.search}`, body, headers: (init.headers ?? {}) as Record<string, string> });
    const route = routes.find((r) => r.method === method && (typeof r.path === "string" ? r.path === url.pathname : r.path.test(url.pathname)));
    if (!route) return new Response(JSON.stringify({ error: { code: "not_found", message: `no route ${method} ${url.pathname}` } }), { status: 404 });
    const out = route.handler(body, url);
    const reply = out instanceof WithStatus ? out : new WithStatus(200, out);
    return new Response(reply.body === undefined ? "" : JSON.stringify(reply.body), { status: reply.status, headers: { "content-type": "application/json" } });
  });
  return api;
}
