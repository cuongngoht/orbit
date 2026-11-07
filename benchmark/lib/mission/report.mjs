// THE REPORT of a mission run (0.5.0, backlog B4, ADR 0055): an engineering run's report -- the code the verifier held,
// the rounds, what was kept apart -- and, beside it, the goal's three legs as the last round judged them, every record row
// that held or not with why, and the mission as the inspection read it back: its verdict, each criterion with the owner's
// records that settle it, and each run with its profile, the agent that carried it and the join's word for how anybody
// knows.
//
//   missionReportOf(room, manifest, view, steps, ending, leaks, events) -> { json, md }
import { docRead } from "../core/room.mjs";
import { reportOf } from "../source/report.mjs";
import { theMission } from "./judge.mjs";

const lastDecided = (json) => json.rounds.map((r) => r.decided).filter(Boolean).at(-1) ?? null;

// The missions the last round's inspection read back, from its own document (the report's rounds keep a summary).
const lastRead = (room, json) => ((r) => (r ? docRead(room, `rounds/${r.round}/inspect/missions.json`)?.json ?? null : null))(json.rounds.filter((x) => x.inspection).at(-1));

const missionIn = (read, json) => (read ? theMission({ missions: read.missions ?? [], engineering: { id: json.rounds.map((r) => r.inspection?.engineering?.id).filter(Boolean).at(-1) ?? null } }) : null);

const missionOf = (room, json) => ((d, m) => ({ legs: d?.legs ?? null, failedLegs: d?.failedLegs ?? [], records: d?.records ?? [], mission: m }))(lastDecided(json), missionIn(lastRead(room, json), json));

const recordLine = (x) => `- ${x.ok ? "held" : "FAILED"} [${x.leg ?? "code"}] ${x.id}: ${x.says}${(x.why ?? []).length ? ` — ${x.why.join("; ")}` : ""}`;

const legsSaid = (ms) => (ms.legs ? Object.entries(ms.legs).map(([leg, held]) => `${leg} ${held ? "held" : "FAILED"}`).join(" · ") : "not judged: no round reached a verdict");

const runLine = (r) => `  - ${r.id} (${r.unit}): ${r.profile} as ${r.agent}, ${r.dispatch}; ${r.lifecycle}${r.outcome ? ` ${r.outcome}` : ""}; carried ${r.attribution ?? "UNATTRIBUTED"}${r.hostAgent ? ` by ${String(r.hostAgent).slice(-8)}` : ""}`;

const missionLines = (m) => (m ? [`- mission ${m.id}: ${m.lifecycle ?? "unknown"}, verdict ${m.verdict ?? "unknown"}; criteria ${(m.criteria ?? []).join(", ") || "none"}`, ...(m.runs ?? []).map(runLine)] : ["- no mission was found in the runner's store"]);

const markdownOf = (ms) => ["## The goal's three legs", "", `Legs: ${legsSaid(ms)}.`, "", ...(ms.records.length ? ms.records.map(recordLine) : ["- no record was read back"]), "", "## The mission, as Satellite's journal says", "", ...missionLines(ms.mission), ""];

export function missionReportOf(room, manifest, view, steps, ending, leaks = null, events = null) {
  const rep = reportOf(room, manifest, view, steps, ending, leaks, events);
  const ms = missionOf(room, rep.json);
  return { json: { ...rep.json, mission: ms }, md: [rep.md, ...markdownOf(ms)].join("\n") };
}
