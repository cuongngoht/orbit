// WHAT THE PLUGIN WROTE, as metadata: after the agent of an arm that carries the plugin ends, the controller reads the
// run's store (ORBIT_STORE_DIR, copied out of the container) and keeps in the run's room ONE bounded file of what the
// plugin observed and did -- its SESSION TRAIL (control/activity/trace/*.jsonl) and the METADATA of every task and work
// journal (<project>/tasks/<id>/journal.jsonl, <project>/work/<id>/journal.jsonl) -- so what the plugin said and held
// (`advice.given`, `turn.held`) and the commands it saw run (`command.ran`) can be read after the run.
//
// The plugin's trail is already an allow-list (it declares every event's fields and keeps no prompt, response, reasoning,
// argument, path or file content). The evaluator does not take that on trust, whatever revision of the plugin wrote it:
// it keeps only values of the SHAPE metadata has -- numbers, booleans, and short tokens with no space (a word, an id, a
// hash) -- in objects and lists a few levels deep, and drops everything else. A journal line is held to the stricter
// form (no `/` in a token, so no path), since a journal is not an allow-list. The file then goes through the room's
// credential scan like every other file of the room.
//
//   trailOf(storeDir) -> { lines: [{ source, id, line }], summary }      TRAIL_FILE      metaOf(value, o) -> value | undefined
//   summary: { events, byType, held: { kind: n }, advice: { fact: n }, commands: { script: n }, journals: { task, work }, cut }
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export const TRAIL_FILE = "orbit-trail.jsonl";

export const MAX_LINES = 5000;

export const MAX_BYTES = 2 * 1024 * 1024;

const MAX_FILE_BYTES = 8 * 1024 * 1024;

// A token: what metadata looks like and a sentence, a command line or an absolute path does not.
const TOKEN = /^[A-Za-z0-9_.:@#+=,-]{1,96}$/;

const SLASHED = /^[A-Za-z0-9_.:@#+=,-][A-Za-z0-9_.:@#+=,/-]{0,95}$/;

const tokenOk = (s, slash) => (slash ? SLASHED.test(s) && !s.split("/").includes("..") : TOKEN.test(s));

// A value as metadata, or undefined: kept only in the shape metadata has.
export function metaOf(v, o = {}, depth = 0) {
  if (typeof v === "number" || typeof v === "boolean" || v === null) return Number.isFinite(v) || typeof v !== "number" ? v : undefined;
  if (typeof v === "string") return tokenOk(v, o.slash) ? v : undefined;
  if (depth >= 5 || typeof v !== "object") return undefined;
  if (Array.isArray(v)) return v.slice(0, 50).map((x) => metaOf(x, o, depth + 1)).filter((x) => x !== undefined);
  const out = {};
  for (const [k, x] of Object.entries(v).slice(0, 60)) ((m) => (TOKEN.test(k) && m !== undefined ? (out[k] = m) : null))(metaOf(x, o, depth + 1));
  return out;
}

// The files of the store that hold what the plugin observed: the trail's shards and every task and work journal.
const SOURCES = [
  { source: "trace", re: /^control\/activity\/trace\/([^/]+)\.jsonl$/, slash: true },
  { source: "task", re: /(?:^|\/)tasks\/([^/]+)\/journal\.jsonl$/, slash: false },
  { source: "work", re: /(?:^|\/)work\/([^/]+)\/journal\.jsonl$/, slash: false },
];

function filesOf(dir, rel = "", depth = 0, out = []) {
  if (depth > 6 || !existsSync(join(dir, rel))) return out;
  for (const name of readdirSync(join(dir, rel)).sort()) {
    const p = rel ? `${rel}/${name}` : name;
    const st = statSync(join(dir, p), { throwIfNoEntry: false });
    if (st?.isDirectory()) filesOf(dir, p, depth + 1, out);
    else if (st?.isFile()) out.push(p);
  }
  return out;
}

const sourceOf = (rel) => ((s) => (s ? { ...s, id: metaOf(s.re.exec(rel)[1]) ?? "?" } : null))(SOURCES.find((x) => x.re.test(rel)));

const parsed = (text) => {
  try { return JSON.parse(text); }
  catch { return undefined; }
};

const linesOfFile = (file) => (statSync(file).size > MAX_FILE_BYTES ? [] : readFileSync(file, "utf8").split("\n").filter(Boolean).map(parsed).filter((x) => x && typeof x === "object"));

export function trailOf(storeDir) {
  const kept = [];
  const s = { bytes: 0, cut: false };
  for (const rel of storeDir ? filesOf(storeDir) : []) {
    const src = sourceOf(rel);
    if (!src) continue;
    for (const line of linesOfFile(join(storeDir, rel))) keep(kept, s, { source: src.source, id: src.id, line: metaOf(line, { slash: src.slash }) });
  }
  return { lines: kept, summary: summaryOf(kept, s.cut) };
}

function keep(kept, s, entry) {
  const bytes = JSON.stringify(entry).length + 1;
  if (kept.length >= MAX_LINES || s.bytes + bytes > MAX_BYTES) return (s.cut = true);
  s.bytes += bytes;
  return kept.push(entry);
}

const tally = (xs) => xs.reduce((o, x) => ((o[x] = (o[x] ?? 0) + 1), o), {});

const events = (kept, type) => kept.filter((k) => k.source === "trace" && (!type || k.line.type === type)).map((k) => k.line);

// What a report counts: the trail's events by type, the holds by what they held for, the advice by the fact it named,
// the plugin's own scripts seen run, and how many task and work journals the plugin kept.
export function summaryOf(kept, cut = false) {
  return {
    events: events(kept).length,
    byType: tally(events(kept).map((e) => e.type ?? "?")),
    held: tally(events(kept, "turn.held").map((e) => e.data?.kind ?? "unsaid")),
    advice: tally(events(kept, "advice.given").map((e) => e.data?.fact ?? "unsaid")),
    commands: tally(events(kept, "command.ran").filter((e) => e.data?.orbit).map((e) => e.data.orbit)),
    journals: { task: new Set(kept.filter((k) => k.source === "task").map((k) => k.id)).size, work: new Set(kept.filter((k) => k.source === "work").map((k) => k.id)).size },
    cut,
  };
}
