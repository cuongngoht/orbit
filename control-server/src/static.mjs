// The built Control Panel, served from control-server/public/ and from nowhere
// else.
//
// This is not a file server. A path is answered only when it resolves -- after
// decoding, and after every symlink -- to a plain file inside public/ whose
// extension is in TYPES. A path with no extension is a page route and gets
// index.html, the single-page fallback. Everything else is a 404, so a
// traversal attempt and a typo get the same answer.
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { contained } from "./core.mjs";
import { missing, notAllowed, unavailable } from "./errors.mjs";

export const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

// Griffel, the CSS-in-JS Fluent UI is built on, inserts <style> rules at run
// time, which is the one reason style-src allows inline. Scripts never do.
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

export const PAGE_HEADERS = { "content-security-policy": CSP, "x-content-type-options": "nosniff", "x-frame-options": "DENY", "referrer-policy": "no-referrer" };

const INDEX = "index.html";

export function serveStatic(ctx, req, res, pathname) {
  if (req.method !== "GET" && req.method !== "HEAD") throw notAllowed("the page answers GET and HEAD only");
  const file = assetOf(ctx.publicRoot, pathname) ?? pageOf(ctx.publicRoot, pathname);
  if (!file) throw missing("NOT_FOUND", "nothing here");
  sent(req, res, file, pathname);
}

function assetOf(root, pathname) {
  const rel = decoded(pathname);
  if (rel === null || !TYPES[extname(rel).toLowerCase()]) return null;
  return plainFile(root, join(root, rel));
}

// Only a path that could be a page route falls back; `/assets/gone.js` is a
// missing asset, and handing it HTML would only hide that.
function pageOf(root, pathname) {
  if (extname(pathname) !== "") return null;
  if (!existsSync(join(root, INDEX))) throw unavailable("PANEL_NOT_BUILT", "the Control Panel has not been built — run npm run build in control-panel/");
  return plainFile(root, join(root, INDEX));
}

function decoded(pathname) {
  try { return clean(decodeURIComponent(pathname)); }
  catch { return null; }
}

const clean = (rel) => (rel.includes("\0") ? null : rel);

function plainFile(root, path) {
  try { return lstatSync(contained(root, path)).isFile() ? path : null; }
  catch { return null; }
}

function sent(req, res, file, pathname) {
  const body = readFileSync(file);
  const cache = pathname.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache";
  res.writeHead(200, { ...PAGE_HEADERS, "content-type": TYPES[extname(file).toLowerCase()], "content-length": body.length, "cache-control": cache });
  res.end(req.method === "HEAD" ? undefined : body);
}
