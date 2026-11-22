// HTTP guards, run before any route or static file:
//
//   hostGuard     the Host header must name an allowed host (loopback by default). A page on another site that
//                 re-binds its own name to 127.0.0.1 still sends ITS name as Host, and is refused (DNS rebinding).
//   accessGate    with ORBIT_WEB_ACCESS_TOKEN set, every /api call but the health check and reading a shared chat's
//                 link needs the token, as an HttpOnly SameSite=Strict cookie (so EventSource works) or a bearer header.
//   mutationGuard a state-changing call must carry the X-Orbit-Web header (a cross-site page cannot add it without a
//                 CORS preflight, which is never answered), an Origin of this very host when the browser sends one,
//                 and a JSON body when it has a body -- but for the one research upload route, whose body is a file's
//                 own bytes.
//   headers       a strict Content-Security-Policy and the usual hardening headers on every response.
//
// The AGENT DOORS (AGENT_DOORS: a governed chat's gateway, /api/agent/..., and an employee's tool endpoint,
// /api/runtime/tools/...) are the one exception to the first three: a run reaches them by Orbit Web's name on its own
// network (not a loopback Host), without the access token, and from a program rather than a page. Each is
// authenticated by its run's own token instead (modules/auth/principals.ts), which a browser never sends by itself,
// and answers nothing else.
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
    if (isAgentPath(req)) return next();
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

// The path as a router could match it -- lower case, repeated slashes as one -- which is the path every guard here
// decides on: a guard comparing the path as sent while the router matched any case let `/API/…` past the access token.
// (The router is made case-sensitive and strict too, bootstrap.ts; this keeps the guards right whatever it does.)
export const routedPath = (path: string): string => path.toLowerCase().replace(/\/{2,}/g, "/");

const isApi = (req: Pick<Request, "path">): boolean => routedPath(req.path).startsWith("/api/");

// THE AGENT DOORS -- every route declared @AgentGateway, each authenticated by a run's own token and nothing else:
//   /api/agent/           a governed chat run's gateway (modules/broker)
//   /api/runtime/tools/   an employee's tool endpoint, reached by its bridge in the model plane (contexts/execution)
// A run reaches them by Orbit Web's name on its own network (`orbit-web`), never a loopback name, so the Host, access
// token and page rules -- which are about browsers -- are not theirs. Held whole by the security spec: a route declared
// @AgentGateway outside these prefixes fails it.
export const AGENT_DOORS = ["/api/agent/", "/api/runtime/tools/"] as const;

export const isAgentPath = (req: Pick<Request, "path">): boolean => {
  const path = routedPath(req.path);
  return AGENT_DOORS.some((door) => path.startsWith(door));
};

// A shared chat's link (modules/share): READING it is the one thing a link's token opens, before the access token. Its
// shape and its existence are the share module's to judge, so a token that names no share is not found either way.
export const isSharedRead = (req: Pick<Request, "method" | "path">): boolean => (req.method === "GET" || req.method === "HEAD") && /^\/api\/shared\/[^/]+$/.test(routedPath(req.path));

export function accessGate(config: AppConfig) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (config.accessToken === null || !isApi(req) || OPEN_PATHS.has(routedPath(req.path)) || isSharedRead(req) || isAgentPath(req)) return next();
    const token = presentedToken(req);
    if (token !== null && sameToken(token, config.accessToken)) return next();
    refuse(res, 401, "access_token_required", "This Orbit Web needs its access token.");
  };
}

export const accessTokenMatches = (config: AppConfig, token: string): boolean => config.accessToken !== null && sameToken(token, config.accessToken);

// Whether this request itself carries the access token (cookie or bearer): what a route that gives the token out checks
// again, whatever the gate in front of it decided.
export function accessTokenPresented(config: AppConfig, req: Request): boolean {
  const token = presentedToken(req);
  return token !== null && accessTokenMatches(config, token);
}

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

const typeIs = (req: Request, type: string): boolean => String(req.headers["content-type"] ?? "").startsWith(type);

// The ONE route whose body is not JSON: a research source's file, sent as its own bytes (never as a form). Only that
// method on that path, only as application/octet-stream -- and held to the header, origin and site rules below like
// every change; the route itself bounds what it reads (modules/research).
export const RESEARCH_UPLOAD = /^\/api\/research\/workspaces\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/sources\/upload$/;

// A chat image's upload.
export const IMAGE_UPLOAD = /^\/api\/images$/;

// The uploads -- the only bodies besides JSON: the file's own bytes, posted to one of these routes and no other.
export const RAW_UPLOADS: readonly RegExp[] = [RESEARCH_UPLOAD, IMAGE_UPLOAD];

export const isRawUpload = (req: Pick<Request, "method" | "path" | "headers">): boolean =>
  req.method === "POST" && RAW_UPLOADS.some((route) => route.test(routedPath(req.path))) && String(req.headers["content-type"] ?? "").startsWith("application/octet-stream");

export function mutationGuard() {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (SAFE_METHODS.has(req.method) || !isApi(req)) return next();
    if (isAgentPath(req)) return hasBody(req) && !typeIs(req, "application/json") ? refuse(res, 415, "json_required", "A request body must be JSON.") : next();
    if (req.headers[MUTATION_HEADER] !== "1") return refuse(res, 403, "missing_header", `A change needs the ${MUTATION_HEADER} header.`);
    if (!originMatches(req)) return refuse(res, 403, "cross_origin", "A change must come from this page's own origin.");
    const site = req.headers["sec-fetch-site"];
    if (site !== undefined && site !== "same-origin" && site !== "none") return refuse(res, 403, "cross_site", "A change must come from this page's own origin.");
    if (hasBody(req) && !typeIs(req, "application/json") && !isRawUpload(req)) return refuse(res, 415, "json_required", "A request body must be JSON.");
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

// An API answer is never kept by a cache between the browser and Orbit Web: it may hold an account's records or a
// session's CSRF token.
export function noStore() {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (isApi(req)) res.setHeader("Cache-Control", "no-store");
    next();
  };
}

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
