// THE REPORT of a sessions benchmark run (0.5.0, ADR 0054): a QA run's report of its SECOND session -- the verdict, the
// rows, the round, the tool calls, every one read exactly as a QA run's are -- with what the first session did and what
// it left beside it: the memory arm the second ran on, what it was offered, the poison planted, and what its work came
// to -- decisions used, designs refused, cost and minutes, the numbers a memory arm is compared on (`memory.measured`).
// Read off the run's own records and never computed again; a number nobody reported is `unknown`.
//
// A round of EITHER session interrupted makes the run's round interrupted: a second session measured after a first one
// a restart cut short is nobody's measure of memory, and is left out of every rate as a restart's run is.
//
//   sessionsReportOf(room, manifest, view, steps, ending, leaks) -> { json, md }
import { dirname } from "node:path/posix";
import { diagnosisLines, diagnosisOf, relayLines } from "../core/diagnosis.mjs";
import { streamOf } from "../core/host.mjs";
import { readRegular } from "../core/room.mjs";
import { qaMarkdownOf, qaReportOf, roundOf, stepOfType, val } from "../qa/report.mjs";
import { LEARN_TYPES } from "./flow.mjs";

const QA = { target: "benchmark.target", qa: "benchmark.qa", readback: "benchmark.readback" };

const tried = (view, type) => (view.actions ?? []).some((a) => a.type === type);

// A round's minutes by the controller's own clock: from its action's start to its end.
const minutesOf = (act) => (act?.startedAt && act?.endedAt ? Math.round((Date.parse(act.endedAt) - Date.parse(act.startedAt)) / 600) / 100 : null);

// One session as its records say it: its application's variant, its investigation, its round, what it came to, the
// host's work in the engine's journal, and its round's minutes.
const sessionOf = (view, steps, types, n) => ((t, qa, rb) => ({ session: n, variant: t?.doc?.variant ?? null, investigation: rb?.doc?.investigation ?? t?.doc?.investigation ?? null, round: roundOf(qa, tried(view, types.qa)), outcomes: rb?.doc?.outcomes ?? null, work: rb?.doc?.work ?? null, minutes: minutesOf(qa?.act) }))(stepOfType(view, steps, types.target), stepOfType(view, steps, types.qa), stepOfType(view, steps, types.readback));

// What the second session's work came to: what a memory arm is compared on.
const measuredOf = (s) => ({ decisions: s.work?.decisions ?? null, designs: s.work?.designs ?? null, designsRefused: s.work?.designsRefused ?? null, stepsRefused: s.work?.stepsRefused ?? null, costUsd: s.round.host?.costUsd ?? null, turns: s.round.host?.turns ?? null, toolCalls: s.round.host?.toolCalls ?? null, minutes: s.minutes });

// Whether the second session's host is SEEN reading the poison: a file tool of its stream, as the controller captured it,
// naming the note or the memory it sits in. Seen proves it looked; not seen proves nothing -- a host may load its own
// memory with no call at all.
const capturedUses = (room) => ((b) => (b ? streamOf(b.toString("utf8")).uses : null))(readRegular(room.at("rounds", "2", "host.stream.jsonl"), 16 * 1024 * 1024));

const seenOf = (room, poison) => ((uses) => (uses === null ? null : uses.some((u) => typeof u.path === "string" && (u.path === poison.at || u.path.startsWith(dirname(poison.at))))))(capturedUses(room));

const poisonOf = (room, carry, measured) => (carry?.poison ? { ...carry.poison, seen: measured.round.driver === "coding-host" ? seenOf(room, carry.poison) : null, basis: "OBSERVED — a file tool of the host's stream, as the controller captured it, naming the note or the memory it sits in" } : null);

const knownSum = (xs) => (xs.every((x) => typeof x === "number") ? Math.round(xs.reduce((a, b) => a + b, 0) * 10000) / 10000 : null);

// The rounds a diagnosis reads: each session's that began, by its own number.
const diagnosedSessions = (room, manifest, ending, sessions) => diagnosisOf({ manifest, ending, rounds: sessions.filter((s) => s.round.driver || s.round.interrupted).map((s) => ({ round: s.session, ...s.round })), relay: [1, 2].flatMap((k) => relayLines(room.at("rounds", String(k), "relay", "relay.jsonl")) ?? []) });

const NOTES = [
  "The second session is what a memory arm is measured on: the first, the same for every arm, learns; its cost and minutes are the run's, and never the arm's.",
  "The off arm switches off what Orbit's switches govern (ORBIT_LEARN, ORBIT_HOST_MEMORY) in every Orbit process of the second session. What no switch governs stays in both arms: the host's own memory, and the investigations and knowledge the engine's store already holds -- `memory.offered` says what that was.",
];

export function sessionsReportOf(room, manifest, view, steps, ending, leaks = null) {
  const base = qaReportOf(room, manifest, view, steps, ending, leaks).json;
  const sessions = [sessionOf(view, steps, LEARN_TYPES, 1), sessionOf(view, steps, QA, 2)];
  const carry = stepOfType(view, steps, "benchmark.carry")?.doc ?? null;
  const json = { ...base, kind: "sessions", round: { ...base.round, interrupted: sessions.some((s) => s.round.interrupted) }, sessions, memory: { arm: manifest.config?.memory ?? null, learnedOn: sessions[0].variant, offered: carry?.kept ?? null, moved: carry?.moved ?? null, poison: poisonOf(room, carry, sessions[1]), measured: measuredOf(sessions[1]) }, totals: { costUsd: knownSum(sessions.filter((s) => s.round.host).map((s) => s.round.host.costUsd)), basis: "REPORTED" }, diagnosis: diagnosedSessions(room, manifest, ending, sessions), unverified: [...base.unverified, ...NOTES] };
  return { json, md: markdownOf(json) };
}

// ---- in words -----------------------------------------------------------------------------------------------------------

const sessionLine = (s) => `- session ${s.session} on ${val(s.variant)}: ${val(s.round.driver)}${s.round.interrupted ? " (interrupted, read back)" : ""} on ${val(s.investigation)} — ${val(s.work?.decisions)} decision(s), ${val(s.work?.designs)} design(s) of which ${val(s.work?.designsRefused)} refused, ${val(s.minutes)} min, ${val(s.round.host?.costUsd)} USD (reported)`;

const offeredLine = (o) => (o ? `- offered to the second session: ${o.engine.investigations.length} earlier investigation(s) and ${o.engine.files} file(s) in the engine's store, ${o.runner.files} in the host's Orbit store, ${o.home.files} in the host's home (${o.home.notes.length} memory note(s))` : "- offered to the second session: unknown — nothing was carried yet");

const poisonLine = (p) => (p ? [`- poison planted in the host's memory at ${p.at} (${p.digest.slice(0, 12)}): it says ${p.skip.join(", ") || "nothing"} need no test, and that ${p.stale.shape} reads its record at \`${p.stale.key}\``, `- the host seen reading it: ${p.seen === null ? "n/a" : p.seen ? "yes" : "no — which proves nothing: a host may load its own memory with no call"}`] : []);

const memoryLines = (j) => [`Memory arm **${val(j.memory.arm)}**; the first session learned on ${val(j.memory.learnedOn)}${j.memory.moved ? `, and the application then moved to ${j.memory.moved.to} (${String(j.memory.moved.commit).slice(0, 12)})` : ""}.`, "", ...j.sessions.map(sessionLine), offeredLine(j.memory.offered), ...poisonLine(j.memory.poison)];

function markdownOf(j) {
  const qa = qaMarkdownOf(j).split("\n");
  return [`# Sessions benchmark run ${j.run} — ${j.outcome}`, ...qa.slice(1, qa.indexOf("## Diagnosis")), "## Sessions and memory", "", ...memoryLines(j), "", "## Diagnosis", "", ...diagnosisLines(j.diagnosis), "", "## Not verified", "", ...j.unverified.map((u) => `- ${u}`), "", `Evidence: ${j.evidence}`, ""].join("\n");
}
