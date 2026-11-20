// HTTP guards, run before any route or static file:
//
//   hostGuard     the Host header must name an allowed host (loopback by default). A page on another site that
//                 re-binds its own name to 127.0.0.1 still sends ITS name as Host, and is refused (DNS rebinding).
//   accessGate    with ORBIT_WEB_ACCESS_TOKEN set, every /api call but the health check and reading a shared chat's
//                 link needs the token, as an HttpOnly SameSite=Strict cookie (so EventSource works) or a bearer header.
//   mutationGuard a state-changing call must carry the X-Orbit-Web header (a cross-site page cannot add it without a
//                 CORS preflight, which is never answered), an Origin of this very host when the browser sends one,
//                 and a JSON body when it has a body.
//   headers       a strict Content-Security-Policy and the usual hardening headers on every response.
import { timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { MUTATION_HEADER } from "@orbit-web/contracts";
import type { AppConfig } from "../../config/config.js";

export const ACCESS_COOKIE = "orbit_web_access";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function refuse(res: Response, status: number, code: string, message: string): void {
  res.status(status).type("application/json").send(JSON.stringify({ error: { code, message } }));
}

// The hostname of a Host header value: `localhost:3000` -> `localhost`, `[::1]:3000` -> `::1`.
export function hostnameOf(host: string | undefined): string | null {
  if (!host) return null;
  const value = host.trim().toLowerCase();
  if (value.startsWith("[")) {
    const end = value.indexOf("]");
    return end > 1 ? value.slice(1, end) : null;
  }
  const colon = value.lastIndexOf(":");
  return colon === -1 ? value : value.slice(0, colon);
}

export function hostGuard(config: AppConfig) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const name = hostnameOf(req.headers.host);
    if (name !== null && config.allowedHosts.includes(name)) return next();
    refuse(res, 421, "host_not_allowed", "This host name is not one Orbit Web answers to.");
  };
}

const sameToken = (given: string, expected: string): boolean => {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
};

export function cookieValue(header: string | undefined, name: string): string | null {
  for (const part of (header ?? "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

function presentedToken(req: Request): string | null {
  const auth = req.headers.authorization;
  if (typeof auth === "string" && auth.startsWith("Bearer ")) return auth.slice(7);
  return cookieValue(req.headers.cookie, ACCESS_COOKIE);
}

const OPEN_PATHS = new Set(["/api/health", "/api/access"]);

// A shared chat's link (modules/share): READING it is the one thing a link's token opens, before the access token. Its
// shape and its existence are the share module's to judge, so a token that names no share is not found either way.
export const isSharedRead = (req: Pick<Request, "method" | "path">): boolean => (req.method === "GET" || req.method === "HEAD") && /^\/api\/shared\/[^/]+$/.test(req.path);

export function accessGate(config: AppConfig) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (config.accessToken === null || !req.path.startsWith("/api/") || OPEN_PATHS.has(req.path) || isSharedRead(req)) return next();
    const token = presentedToken(req);
    if (token !== null && sameToken(token, config.accessToken)) return next();
    refuse(res, 401, "access_token_required", "This Orbit Web needs its access token.");
  };
}

export const accessTokenMatches = (config: AppConfig, token: string): boolean => config.accessToken !== null && sameToken(token, config.accessToken);

function originMatches(req: Request): boolean {
  const origin = req.headers.origin;
  if (origin === undefined) return true;
  try {
    return new URL(origin).host.toLowerCase() === String(req.headers.host ?? "").toLowerCase();
  } catch {
    return false;
  }
}

const hasBody = (req: Request): boolean => Number(req.headers["content-length"] ?? 0) > 0 || req.headers["transfer-encoding"] !== undefined;

export function mutationGuard() {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (SAFE_METHODS.has(req.method) || !req.path.startsWith("/api/")) return next();
    if (req.headers[MUTATION_HEADER] !== "1") return refuse(res, 403, "missing_header", `A change needs the ${MUTATION_HEADER} header.`);
    if (!originMatches(req)) return refuse(res, 403, "cross_origin", "A change must come from this page's own origin.");
    const site = req.headers["sec-fetch-site"];
    if (site !== undefined && site !== "same-origin" && site !== "none") return refuse(res, 403, "cross_site", "A change must come from this page's own origin.");
    if (hasBody(req) && !String(req.headers["content-type"] ?? "").startsWith("application/json")) return refuse(res, 415, "json_required", "A request body must be JSON.");
    next();
  };
}

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  // Fluent UI writes its styles at run time.
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

export function securityHeaders() {
  return (_req: Request, res: Response, next: NextFunction): void => {
    res.setHeader("Content-Security-Policy", CSP);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    res.removeHeader("X-Powered-By");
    next();
  };
}
