// The invoice API (contracts/openapi.json, served under /api) and its page, /invoices.
//
// An identity is a bearer token, or the session /login opens from one (a random session id in an
// HttpOnly, SameSite=Strict cookie; the token itself is never in a cookie or a URL). It carries a
// principal, a tenant and a role. Every read is scoped to the caller's tenant, and an invoice of
// another tenant is simply not found. Signing in and out are POSTs that must come from this
// origin (Origin, else Referer), so another site can neither sign a browser in nor out.
import { createHash, randomBytes } from "node:crypto";
import { config, log } from "./config.mjs";
import { sql } from "./db.mjs";
import { HttpError, bearerOf, bodyOf, cookies, jsonBody, serve, unauthorized } from "./http.mjs";
import { heartbeat, markReady } from "./role.mjs";

const ID = /^[a-z0-9-]{1,64}$/;
const KEY = /^[\x21-\x7e]{8,120}$/;
const COLUMNS = sql`id, tenant_id, name, amount, status, marker`;
const SESSION_HOURS = 8;

const hashOf = (text) => createHash("sha256").update(String(text)).digest("hex");

function invoiceJson(r) {
  const out = { id: r.id, tenantId: r.tenant_id, name: r.name, amount: Number(r.amount), status: r.status };
  if (r.marker) out.marker = r.marker;
  return out;
}

// ---- who is asking ----------------------------------------------------------------------------

async function byToken(db, token) {
  if (!token || token.length > 200) return null;
  const found = await db.query(sql`SELECT principal, tenant_id, role, token_hash FROM tokens WHERE token_hash = ${hashOf(token)}`);
  return found.rows[0] ?? null;
}

async function bySession(db, sid) {
  if (!sid || sid.length > 200) return null;
  const found = await db.query(sql`SELECT t.principal, t.tenant_id, t.role, t.token_hash FROM sessions s JOIN tokens t ON t.token_hash = s.token_hash
    WHERE s.sid_hash = ${hashOf(sid)} AND s.expires_at > now()`);
  return found.rows[0] ?? null;
}

async function identityOf(db, req) {
  if (config.variant === "broken-auth") return null;
  const bearer = bearerOf(req);
  return bearer ? byToken(db, bearer) : bySession(db, cookies(req).session);
}

async function identified(db, req) {
  const who = await identityOf(db, req);
  if (!who) throw unauthorized();
  return who;
}

// ---- the API ----------------------------------------------------------------------------------

// The tenant condition every read carries -- except in the variant built without it.
const scope = (who) => (config.variant === "no-tenant-check" ? sql`TRUE` : sql`tenant_id = ${who.tenant_id}`);

async function search(db, { req, url }) {
  const who = await identified(db, req);
  const q = url.searchParams.get("q");
  if (typeof q !== "string" || !q.trim() || q.length > 120) throw new HttpError(400, "invalid");
  const found = await db.query(`SELECT ${COLUMNS} FROM invoices WHERE ${scope(who)} AND position(lower(${sql`${q.trim()}`}) in lower(name)) > 0 ORDER BY name, id LIMIT 50`);
  return { body: { invoices: found.rows.map(invoiceJson) } };
}

async function read(db, { req, params }) {
  const who = await identified(db, req);
  if (!ID.test(params.id)) throw new HttpError(404, "not_found");
  const found = await db.query(`SELECT ${COLUMNS} FROM invoices WHERE ${sql`id = ${params.id}`} AND ${scope(who)}`);
  if (!found.rows.length) throw new HttpError(404, "not_found");
  return { body: invoiceJson(found.rows[0]) };
}

function newInvoice(body) {
  const ok = body && typeof body === "object" && !Array.isArray(body) && Object.keys(body).every((k) => ["name", "amount"].includes(k));
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const amount = body?.amount;
  if (!ok || !name || name.length > 120 || typeof amount !== "number" || !Number.isFinite(amount) || amount < 0 || amount > 1000000) throw new HttpError(400, "invalid");
  return { name, amount: Math.round(amount * 100) / 100 };
}

async function create(db, { req }) {
  const who = await identified(db, req);
  if (who.role !== "writer") throw new HttpError(403, "forbidden");
  const key = String(req.headers["idempotency-key"] ?? "");
  if (!KEY.test(key)) throw new HttpError(400, "invalid");
  const inv = newInvoice(await jsonBody(req));
  const digest = createHash("sha256").update(JSON.stringify(inv)).digest("hex");
  const id = `inv-${randomBytes(6).toString("hex")}`;
  if (config.variant === "toast-without-persistence") return { status: 201, body: invoiceJson({ id, tenant_id: who.tenant_id, ...inv, status: "open" }) };
  const made = await db.query(sql`INSERT INTO invoices (id, tenant_id, name, amount, idempotency_key, request_digest) VALUES (${id}, ${who.tenant_id}, ${inv.name}, ${inv.amount}, ${key}, ${digest})
    ON CONFLICT (tenant_id, idempotency_key) DO NOTHING RETURNING id, tenant_id, name, amount, status, marker`);
  if (made.rows.length) return { status: 201, body: invoiceJson(made.rows[0]) };
  const prior = await db.query(sql`SELECT id, tenant_id, name, amount, status, marker, request_digest FROM invoices WHERE tenant_id = ${who.tenant_id} AND idempotency_key = ${key}`);
  if (prior.rows[0]?.request_digest !== digest) throw new HttpError(409, "conflict");
  return { status: 200, body: invoiceJson(prior.rows[0]) };
}

// ---- signing in and out -----------------------------------------------------------------------

// Where to go after signing in: a path on THIS origin, never a scheme-relative or backslashed one.
export function safeNext(next) {
  if (typeof next !== "string" || !next.startsWith("/") || /[\\\u0000-\u001f\u007f]/.test(next)) return "/invoices";
  let url;
  try {
    url = new URL(next, "http://local");
  } catch {
    return "/invoices";
  }
  return url.origin === "http://local" ? `${url.pathname}${url.search}` : "/invoices";
}

// A state-changing form post must come from this origin: its Origin header, else its Referer,
// names the host the request was sent to. Neither, or "null", is refused.
export function sameOrigin(req) {
  const host = String(req.headers.host ?? "");
  const from = req.headers.origin ?? req.headers.referer;
  if (!host || typeof from !== "string" || from === "null") return false;
  try {
    return new URL(from).host === host;
  } catch {
    return false;
  }
}

async function formOf(req) {
  const raw = (await bodyOf(req)).toString("utf8");
  if (/json/i.test(String(req.headers["content-type"] ?? ""))) {
    try {
      return JSON.parse(raw || "{}");
    } catch {
      throw new HttpError(400, "invalid");
    }
  }
  return Object.fromEntries(new URLSearchParams(raw));
}

const SESSION_COOKIE = (sid, maxAge) => `session=${sid}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}`;

async function signIn(db, { req }) {
  if (!sameOrigin(req)) throw new HttpError(403, "forbidden");
  const form = await formOf(req);
  const who = typeof form.token === "string" ? await (config.variant === "broken-auth" ? null : byToken(db, form.token)) : null;
  if (!who) return { status: 401, html: LOGIN("That token is not valid.", form.next) };
  const sid = randomBytes(32).toString("base64url");
  await db.query(sql`INSERT INTO sessions (sid_hash, token_hash, expires_at) VALUES (${hashOf(sid)}, ${who.token_hash}, now() + ${`${SESSION_HOURS} hours`}::interval)`);
  return { status: 303, redirect: safeNext(form.next), headers: { "set-cookie": SESSION_COOKIE(sid, SESSION_HOURS * 3600) } };
}

async function signOut(db, { req }) {
  if (!sameOrigin(req)) throw new HttpError(403, "forbidden");
  const sid = cookies(req).session;
  if (sid) await db.query(sql`DELETE FROM sessions WHERE sid_hash = ${hashOf(sid)}`);
  return { status: 303, redirect: "/login", headers: { "set-cookie": SESSION_COOKIE("", 0) } };
}

// A token in a URL is in every log and history it passes through: the form never puts it there,
// and a sign-in link that tries is refused.
function loginPage({ url }) {
  if (url.searchParams.has("token")) return { status: 400, html: LOGIN("A token is never sent in a URL. Sign in with the form.", url.searchParams.get("next")) };
  return { html: LOGIN(null, url.searchParams.get("next")) };
}

async function invoicesPage(db, { req }) {
  const who = await identityOf(db, req);
  if (!who) return { status: 303, redirect: "/login?next=/invoices" };
  return { html: INVOICES(who) };
}

// ---- the page ---------------------------------------------------------------------------------

const escapeHtml = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const STYLE = "body{font-family:system-ui,sans-serif;margin:2rem;max-width:44rem}label{margin-right:.75rem}li{margin:.25rem 0}.toast{background:#e7f5e9;padding:.5rem;margin-top:1rem}.toast[data-state=error]{background:#fbe9e9}.error{color:#a00}form.inline{display:inline}";

const page = (title, body) => `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><link rel="stylesheet" href="/assets/style.css"></head><body>${body}</body></html>\n`;

const LOGIN = (message, next) => page("Sign in", `<h1>Sign in</h1>${message ? `<p class="error" data-testid="login-error">${escapeHtml(message)}</p>` : ""}
<form method="post" action="/login"><input type="hidden" name="next" value="${escapeHtml(safeNext(next))}"><label>Token <input name="token" type="password" data-testid="token" autocomplete="off"></label><button data-testid="sign-in" type="submit">Sign in</button></form>`);

const SCRIPT = `
const results = document.querySelector('[data-testid=results]');
const failure = document.querySelector('[data-testid=results-error]');
const toast = document.querySelector('[data-testid=toast]');
const randomKey = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
document.getElementById('search-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const q = document.querySelector('[data-testid=search]').value.trim();
  results.setAttribute('data-loading', 'true');
  failure.hidden = true;
  results.replaceChildren();
  try {
    const r = await fetch('/api/invoices?q=' + encodeURIComponent(q), { credentials: 'same-origin' });
    const body = await r.json();
    if (!r.ok) throw new Error(body.error || String(r.status));
    for (const inv of body.invoices) {
      const li = document.createElement('li');
      li.setAttribute('data-testid', 'result');
      li.dataset.id = inv.id;
      li.textContent = inv.name + ' (' + inv.amount + ')';
      results.append(li);
    }
    if (!body.invoices.length) {
      const li = document.createElement('li');
      li.setAttribute('data-testid', 'no-results');
      li.textContent = 'No invoices match.';
      results.append(li);
    }
  } catch (err) {
    failure.textContent = 'Search failed: ' + err.message;
    failure.hidden = false;
  } finally {
    results.setAttribute('data-loading', 'false');
  }
});
document.getElementById('create-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  toast.hidden = true;
  const name = document.querySelector('[data-testid=create-name]').value.trim();
  const amount = Number(document.querySelector('[data-testid=create-amount]').value);
  const r = await fetch('/api/invoices', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json', 'idempotency-key': randomKey() }, body: JSON.stringify({ name, amount }) });
  const body = await r.json().catch(() => ({}));
  toast.textContent = r.ok ? 'Invoice created: ' + body.name : 'Could not create the invoice (' + (body.error || r.status) + ')';
  toast.dataset.state = r.ok ? 'success' : 'error';
  toast.hidden = false;
});
`;

const INVOICES = (who) => page("Invoices", `<h1>Invoices</h1>
<p data-testid="whoami">Signed in as <b>${escapeHtml(who.principal)}</b> (${escapeHtml(who.tenant_id)}) · <form class="inline" method="post" action="/logout"><button data-testid="sign-out" type="submit">Sign out</button></form></p>
<form id="search-form" data-testid="search-form"><label>Name <input data-testid="search" name="q" maxlength="120" autocomplete="off"></label><button data-testid="search-submit" type="submit">Search</button></form>
<p data-testid="results-error" class="error" hidden></p>
<ul data-testid="results"></ul>
<h2>New invoice</h2>
<form id="create-form" data-testid="create-form"><label>Name <input data-testid="create-name" name="name" maxlength="120" required></label><label>Amount <input data-testid="create-amount" name="amount" type="number" min="0" max="1000000" step="0.01" required></label><button data-testid="create-submit" type="submit">Create</button></form>
<div data-testid="toast" class="toast" role="status" hidden></div>
<script src="/assets/invoices.js"></script>`);

// ---- health -----------------------------------------------------------------------------------

// `?all=1`: every workload that should run, runs and beat within ten seconds.
async function health(db, { url }) {
  if (url.searchParams.get("all") !== "1") return (await db.query("SELECT 1"), { body: { ok: true } });
  const rows = (await db.query(sql`SELECT workload FROM controls WHERE desired = 'running' AND NOT (actual = 'running' AND heartbeat_at > clock_timestamp() - interval '10 seconds')`)).rows;
  return rows.length ? { status: 503, body: { ok: false, waiting: rows.map((r) => r.workload) } } : { body: { ok: true } };
}

export async function runApi(db) {
  const routes = [
    { method: "GET", path: /^\/health$/, handler: (c) => health(db, c) },
    { method: "GET", path: /^\/assets\/invoices\.js$/, handler: () => ({ text: SCRIPT, type: "text/javascript; charset=utf-8" }) },
    { method: "GET", path: /^\/assets\/style\.css$/, handler: () => ({ text: STYLE, type: "text/css; charset=utf-8" }) },
    { method: "GET", path: /^\/login$/, handler: (c) => loginPage(c) },
    { method: "POST", path: /^\/login$/, handler: (c) => signIn(db, c) },
    { method: "POST", path: /^\/logout$/, handler: (c) => signOut(db, c) },
    { method: "GET", path: /^\/$/, handler: () => ({ status: 303, redirect: "/invoices" }) },
    { method: "GET", path: /^\/invoices$/, handler: (c) => invoicesPage(db, c) },
    { method: "GET", path: /^\/api\/invoices$/, handler: (c) => search(db, c) },
    { method: "POST", path: /^\/api\/invoices$/, handler: (c) => create(db, c) },
    { method: "GET", path: /^\/api\/invoices\/(?<id>[^/]+)$/, handler: (c) => read(db, c) },
  ];
  await serve({ port: config.ports.api, routes, name: "api", log });
  await markReady(db, "api");
  heartbeat(db, "api");
}
