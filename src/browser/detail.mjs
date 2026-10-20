// ONE request's detail, as `playwright-cli --raw request <n>` prints it:
//
//   #2 [POST] http://127.0.0.1:18765/api/workspaces
//
//     General
//       status:    [201] Created          or  [FAILED] net::ERR_…
//       duration:  2ms
//       type:      fetch
//       mimeType:  application/json
//
//     Request headers
//       x-request-id: abc
//
//     Response headers
//       content-type: application/json
//
// Measured against playwright-cli 0.1.19 on a local server, and what it does
// NOT print is as much the contract as what it does: no start or end time, no
// initiator, no retry marker, and a CORS preflight never appears in the log at
// all. Those stay absent here -- never guessed from what is there.
//
// Headers come back VERBATIM, an Authorization header included, so this parser
// is the last place a raw value exists. Nothing keeps what it returns: a caller
// takes src/network/redact.mjs's view of it, which is an ALLOW-list.
const HEAD = /^#(\d+)\s+\[(\w+)\]\s+(\S+)/;
const SECTIONS = { General: "general", "Request headers": "request", "Response headers": "response" };
const FIELD = /^([^:\s][^:]*):\s?(.*)$/;
const ANSWERED = /^\[(\d{3})\]\s*(.*)$/;
const FAILED = /^\[FAILED\]\s*(.*)$/;
const DURATION = /^(\d+(?:\.\d+)?)\s*(ms|s)$/;

export function parseDetail(text) {
  const lines = String(text ?? "").split(/\r?\n/);
  const head = lines.map((l) => HEAD.exec(l.trim())).find(Boolean);
  if (!head) return null;
  return detailOf(head, sectioned(lines));
}

function sectioned(lines) {
  const parts = { general: {}, request: {}, response: {} };
  lines.reduce((at, line) => into(parts, at, line), null);
  return parts;
}

function into(parts, at, line) {
  const t = line.trim();
  if (SECTIONS[t]) return SECTIONS[t];
  const m = at ? FIELD.exec(t) : null;
  if (m) parts[at][at === "general" ? m[1] : m[1].toLowerCase()] = m[2].trim();
  return at;
}

function detailOf(head, parts) {
  const g = parts.general;
  return { n: +head[1], method: head[2], url: head[3], ...statusOf(g.status), durationMs: durationOf(g.duration), type: g.type ?? null, mimeType: g.mimeType ?? null, requestHeaders: parts.request, responseHeaders: parts.response };
}

function statusOf(text) {
  const ok = ANSWERED.exec(String(text ?? ""));
  if (ok) return { status: +ok[1], statusText: ok[2] || null, failed: null };
  const failed = FAILED.exec(String(text ?? ""));
  return { status: null, statusText: null, failed: failed ? failed[1] || "failed" : null };
}

function durationOf(text) {
  const m = DURATION.exec(String(text ?? "").trim());
  if (!m) return null;
  return m[2] === "s" ? Math.round(+m[1] * 1000) : +m[1];
}

// A body the CLI could not read comes back as the session's "ERROR: …" text,
// and a request that had none prints nothing. Neither is a body.
export const bodyOf = (text) => (typeof text !== "string" || text === "" || text.startsWith("ERROR") ? null : text.replace(/\r?\n$/, ""));

// `Total messages: 3 (Errors: 2, Warnings: 1)` -- the console's own count, so a
// caller can take it before and after an action and read the difference.
const TOTALS = /Total messages:\s*(\d+)\s*\(Errors:\s*(\d+),\s*Warnings:\s*(\d+)\)/;

export function consoleTotals(text) {
  const m = TOTALS.exec(String(text ?? ""));
  return m ? { total: +m[1], errors: +m[2], warnings: +m[3] } : null;
}

// Each `[ERROR] …` line, and the first line of an uncaught error. Messages are
// the page talking and may carry anything, so a caller scrubs before keeping.
export function consoleErrors(text) {
  return String(text ?? "").split(/\r?\n/).filter((l) => /^\[ERROR\]\s|^(?:Uncaught\s)?\w*Error:\s/.test(l.trim())).map((l) => l.trim());
}
