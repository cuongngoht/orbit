// The request log playwright-cli keeps, parsed.
//   `123. [POST] https://…/api/v2/x => [201] Created`
//   `124. [GET] https://…/api/v2/y`                     -- still in flight
//
// The status is OPTIONAL in this pattern, and that is load-bearing rather than
// tidy. A request with no answer yet used to be invisible, so one that was in
// flight when the watermark was taken looked NEW when it finally landed -- the
// same false pass the watermark exists to remove, one step further along.
const REQ_LINE = /^\s*(\d+)\.\s*\[(\w+)\]\s*(\S+)(?:\s*=>\s*\[(\d{3})\])?/;
const NON_2XX = /=> \[(?!2\d\d)\d{3}\]/;
const ANY_STATUS = /=> \[\d{3}\]/;

export function parseRequests(text) {
  return String(text).split("\n").map((l) => [REQ_LINE.exec(l), l]).filter(([m]) => m).map(([m, l]) => recordOf(m, l));
}

// `=> [FAILED] net::ERR_…` is a request that ENDED without an answer. `status`
// stays null for it, exactly as before, so nothing that reads a status changes
// meaning; `failed` is an optional field saying why, present only when the log
// says so. Without it a failed request and one still in flight were the same.
const FAILED_LINE = /=>\s*\[FAILED\]\s*(\S+)?/;

function recordOf(m, line) {
  const failed = FAILED_LINE.exec(line);
  const r = { n: +m[1], method: m[2], url: m[3], status: m[4] ? +m[4] : null };
  return failed ? { ...r, failed: failed[1] ?? "failed" } : r;
}

// The highest sequence number in the log. Taken BEFORE an action, it is the line
// between "the UI had already done this" and "the UI just did this".
export const highestRequest = (requests) => requests.reduce((max, r) => Math.max(max, r.n), 0);

// Every matching request made AFTER that line. The old `lastMatching` scanned
// the whole log and returned the last hit, so a call made minutes earlier -- by
// the page load, by the previous case, by a retry -- satisfied a step asking
// about the click that had just happened.
export function newerMatching(requests, since, match, method) {
  const re = new RegExp(match);
  const want = method?.toUpperCase();
  return requests.filter((r) => r.n > since && re.test(r.url) && (!want || r.method === want));
}

export function summarize(text) {
  const lines = String(text).split("\n");
  return { calls: lines.filter((l) => ANY_STATUS.test(l)).length, bad: lines.filter((l) => NON_2XX.test(l)).map((l) => l.trim()) };
}
