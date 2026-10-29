// A LOCK: the one thing that decides what a `python-lock` install may fetch. It names every distribution (name and
// exact version) and, for each, every SHA-256 pip may accept for it. pip is run with --require-hashes over it, so what
// is installed is exactly what the lock names -- a different file, a newer release or a changed mirror is refused by
// pip itself -- and this file is the check that the lock is ONLY that, BEFORE pip is run.
//
// One requirement per line:  name==version --hash=sha256:<64 hex> [--hash=sha256:<64 hex> ...]
// A blank line and a `#` comment are allowed. Nothing else is: no option (an index, a link page, a trusted host, an
// editable), no URL or VCS reference, no path, no environment marker, no continuation. The lock is data shipped with
// the plugin, so this is not defence against the lock -- it is the guarantee that a lock that is edited, or generated
// wrongly, can never widen what an install runs.
//
// Pure: it reads a string. The generator (skills/orbit-release/pin-python-lock.mjs) writes in this grammar and the
// installer (src/tools/pylock.mjs) holds the file to it again.
const REQUIREMENT = /^([A-Za-z0-9][A-Za-z0-9._-]*)==([A-Za-z0-9][A-Za-z0-9.!+_-]*)((?: --hash=sha256:[a-f0-9]{64})+)$/;

const requirementsOf = (text) => String(text).split(/\r?\n/).map((raw, i) => ({ at: i + 1, line: raw.trim() })).filter((l) => l.line && !l.line.startsWith("#"));

// Every way the lock is not the grammar above, each with its line number; an empty list is a lock that may be installed.
export function lockProblems(text) {
  const rows = requirementsOf(text);
  const bad = rows.filter((r) => !REQUIREMENT.test(r.line)).map((r) => `line ${r.at}: not a pinned, hashed requirement`);
  const dup = duplicates(rows.filter((r) => REQUIREMENT.test(r.line)));
  return [...(rows.length ? [] : ["the lock names no distribution"]), ...bad, ...dup];
}

const nameOf = (line) => REQUIREMENT.exec(line)[1].toLowerCase().replace(/[-_.]+/g, "-");

function duplicates(rows) {
  const seen = new Set();
  return rows.filter((r) => (seen.has(nameOf(r.line)) ? true : (seen.add(nameOf(r.line)), false))).map((r) => `line ${r.at}: ${nameOf(r.line)} is pinned twice`);
}

// The version a lock pins a distribution to, or null: what the install is then held to by the pinned row.
export function pinnedIn(text, name) {
  const wanted = String(name).toLowerCase().replace(/[-_.]+/g, "-");
  const hit = requirementsOf(text).filter((r) => REQUIREMENT.test(r.line)).find((r) => nameOf(r.line) === wanted);
  return hit ? REQUIREMENT.exec(hit.line)[2] : null;
}
