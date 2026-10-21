// A small HTTP server: ordered routes, JSON in and out, bounded bodies, and the security headers
// every answer carries. A handler answers { status, body } (JSON), { status, html },
// { status, text, type } or { status, redirect }, plus optional headers.
import { createHash, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";

const LIMIT = 64 * 1024;

export class HttpError extends Error {
  constructor(status, error, extra = {}, headers = {}) {
    super(error);
    this.status = status;
    this.body = { error, ...extra };
    this.headers = headers;
  }
}

export function bodyOf(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > LIMIT) {
        reject(new HttpError(413, "invalid"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

export async function jsonBody(req) {
  const raw = await bodyOf(req);
  if (!raw.length) return undefined;
  try {
    return JSON.parse(raw.toString("utf8"));
  } catch {
    throw new HttpError(400, "invalid");
  }
}

// A cookie value that is not valid percent-encoding is kept as it came, never a crash.
const decoded = (v) => {
  try {
    return decodeURIComponent(v);
  } catch {
    return v;
  }
};

export function cookies(req) {
  return Object.fromEntries(String(req.headers.cookie ?? "").split(";").map((p) => p.trim().split("=")).filter(([k]) => k).map(([k, ...v]) => [k, decoded(v.join("="))]));
}

export const bearerOf = (req) => /^Bearer\s+(\S+)$/i.exec(String(req.headers.authorization ?? ""))?.[1] ?? null;

const digestOf = (text) => createHash("sha256").update(String(text)).digest();

export const unauthorized = () => new HttpError(401, "unauthorized", {}, { "www-authenticate": "Bearer" });

// A guard for a shared secret: the bearer token must be the secret, compared in constant time on
// digests (so neither its length nor its prefix leaks), or the request is 401.
export function secretGuard(secret) {
  const expected = digestOf(secret);
  return (req) => {
    const given = bearerOf(req);
    if (!given || !timingSafeEqual(digestOf(given), expected)) throw unauthorized();
  };
}

const BASE = { "cache-control": "no-store", "x-content-type-options": "nosniff", "referrer-policy": "same-origin" };
const PAGE = { "content-security-policy": "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'", "x-frame-options": "DENY" };

function send(res, out) {
  const headers = { ...BASE, ...(out.headers ?? {}) };
  if (out.redirect) {
    res.writeHead(out.status ?? 303, { ...headers, location: out.redirect });
    return res.end();
  }
  if (out.html !== undefined) {
    res.writeHead(out.status ?? 200, { ...headers, ...PAGE, "content-type": "text/html; charset=utf-8" });
    return res.end(out.html);
  }
  if (out.text !== undefined) {
    res.writeHead(out.status ?? 200, { ...headers, "content-type": out.type });
    return res.end(out.text);
  }
  res.writeHead(out.status ?? 200, { ...headers, "content-type": "application/json" });
  return res.end(JSON.stringify(out.body ?? {}));
}

const matches = (route, method, path) => (route.method === method || (route.method === "GET" && method === "HEAD")) && route.path.exec(path);

// `guard(req)` runs before every route that does not say `open: true`, and throws to refuse.
export function serve({ port, routes, name, log, guard = null }) {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://local");
    try {
      for (const route of routes) {
        const m = matches(route, req.method, url.pathname);
        if (!m) continue;
        if (guard && !route.open) guard(req);
        return send(res, await route.handler({ req, url, params: m.groups ?? {} }));
      }
      return send(res, { status: 404, body: { error: "not_found" } });
    } catch (e) {
      if (e instanceof HttpError) return send(res, { status: e.status, body: e.body, headers: e.headers });
      log(name, `answering ${req.method} ${url.pathname} failed: ${e.message}`);
      return send(res, { status: 500, body: { error: "internal" } });
    }
  });
  return new Promise((resolve) => server.listen(port, "0.0.0.0", () => resolve(server)));
}
