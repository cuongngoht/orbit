// A LESSON is one thing several sessions have shown, written down with what
// showed it. It is not "the case failed" -- that is the ledger's job -- and it is
// not "I think this is flaky", which is an opinion with no evidence attached.
//
// One lesson, one file. Both obvious alternatives are worse: a merged document
// per topic has to be parsed, re-merged and rewritten by every writer, which
// turns every save into a lock and every hand-edit into a round-trip risk. One
// file per lesson makes a save atomic, lets two sessions write two lessons at
// once without meeting, and reduces the parse problem to the frontmatter shape
// the notes already use. The six topic files the design asks for are RENDERED
// from these (projection.mjs) -- derived, so a damaged one is rebuilt.
//
// The file is generated. The markdown is what a person reads; the fenced JSON at
// the bottom is what the tool reads. A file whose JSON will not parse is SKIPPED
// and reported -- never rewritten, never dropped -- because it is the one case
// where the tool cannot know what it would be destroying. Corrections go through
// `learn remember --id=...`, which regenerates both halves together.
import { Refused } from "../errors.mjs";
import { KINDS, lessonId } from "./fingerprint.mjs";
import { scrubbed } from "../scrub.mjs";

export const LESSON_KEYS = ["id", "about", "kind", "family", "topic", "state", "sessions", "fe_commit", "confirmed", "at", "host"];

const NEEDS = ["kind", "family", "topic", "about", "key", "statement"];

const DEFAULTS = { applies: [], notWhen: [], state: "candidate", because: "", sessions: 0, counters: { for: 0, against: 0, hosts: 0, runs: 0, notes: 0 }, evidence: { sessions: [], runs: [], notes: [], missing: [] }, scope: {}, fe_commit: null, firstSeen: null, confirmed: null, supersedes: null, body: "" };

// The single constructor, and therefore the single place a secret can be caught
// on its way in -- exactly as makeNote is the only constructor of a note.
export function makeLesson(fields, deps = {}) {
  const now = deps.now ?? (() => new Date().toISOString());
  const checked = required(fields);
  const at = fields.at ?? now();
  return scrubbed({ ...DEFAULTS, ...checked, id: fields.id ?? lessonId(checked), at, host: fields.host ?? deps.host ?? null });
}

function required(f) {
  const missing = NEEDS.filter((k) => !f[k]);
  if (missing.length) throw new Refused(`a lesson needs ${missing.join(", ")}`);
  if (!KINDS.includes(f.kind)) throw new Refused(`a lesson's kind is ${KINDS.join(" or ")}, not "${f.kind}"`);
  return f;
}

export function formatLesson(lesson) {
  const head = LESSON_KEYS.map((k) => `${k}: ${scalar(lesson[k])}`).join("\n");
  return `---\n${head}\n---\n\n${prose(lesson)}\n\n${fenced(lesson)}\n`;
}

const scalar = (v) => (v === null || v === undefined ? "" : String(v));

function prose(l) {
  const parts = [`# ${l.statement}`, "", origin(l), "", ...listSection("It applies when", l.applies), ...listSection("It does NOT apply when", l.notWhen)];
  const why = [`## Why this is ${l.state}`, "", l.because || "no reason was recorded.", ""];
  return [...parts, ...why, ...evidenceSection(l), ...listSection("Not known", l.evidence?.missing)].join("\n").trim();
}

// Which KIND of evidence this is, in the first line a reader meets, because a
// person's instruction and an inference over logs must never read the same.
const origin = (l) => (l.kind === "said" ? "**A person said so.** It is an instruction, not an inference, and no recommendation may cite it as evidence." : "**Inferred from the ledger.** Nobody said this; it is what the runs did.");

// Rendered even when empty. A section that disappears when it has nothing to say
// teaches the reader that its absence means "everything is known", which is the
// opposite of true.
const listSection = (title, items) => [`## ${title}`, "", ...bullets(items), ""];

const bullets = (items) => (items?.length ? items.map((i) => `- ${i}`) : ["- nothing"]);

function evidenceSection(l) {
  const rows = (l.evidence?.runs ?? []).map(runRow);
  const table = rows.length ? ["| session | run | verdict | frontend |", "|---|---|---|---|", ...rows] : ["No run is cited."];
  return ["## Evidence", "", ...table, "", ...noteLine(l), ""];
}

const runRow = (r) => `| ${r.session ?? "?"} | ${r.at ?? "?"} | ${r.verdict ?? r.status ?? "?"} | ${r.fe_commit ?? "?"} |`;

const noteLine = (l) => (l.evidence?.notes?.length ? [`Notes: ${l.evidence.notes.join(", ")}`] : []);

const fenced = (lesson) => ["```json", JSON.stringify(lesson, null, 2), "```"].join("\n");

// CRLF first. A store read on Windows that anchored on \n matched nothing, and
// `query notes` went silently empty on exactly the machines a shared store exists
// to serve. The notes learned that the hard way; this does not have to.
export function parseLesson(text, file = null) {
  const body = String(text ?? "").replace(/\r\n/g, "\n");
  const found = /```json\n([\s\S]*?)\n```/.exec(body);
  const record = found ? jsonOf(found[1]) : null;
  return record ? { ...record, file } : null;
}

function jsonOf(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
