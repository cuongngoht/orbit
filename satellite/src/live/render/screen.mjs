// The live view as SCREEN LINES for a terminal that watches a mission (and for `live status`): the header with the
// viewer's own state, the mission, every agent with its own mode, factory activity, what is executing, and the
// evidence -- each line cut to the terminal's width by what it SHOWS (Orbit Live's drawn()), and coloured only by
// Orbit Live's one escape emitter.
import { drawn } from "../../../../src/live/render/width.mjs";
import { dim, seg } from "../../../../src/live/tui/sections/parts.mjs";
import { TONE_OF_LEVEL, TONE_OF_STATE, VERDICT_SAY } from "../tones.mjs";

const header = (view, viewer) => [seg(" SATELLITE LIVE ", "chip"), seg(" "), seg(`${viewer.glyph} ${viewer.word}`, viewer.tone), dim(`   ${view.mission.id ?? "no mission"}   revision ${view.meta.seq}`)];

const missionLine = (view) => [seg("MISSION ", "label"), seg(view.mission.objective ?? ""), dim("   "), seg(view.mission.lifecycle, "brand"), dim(" · "), seg(VERDICT_SAY[view.mission.verdict] ?? view.mission.verdict)];

const section = (title) => [seg(title, "label")];

const agentLine = (a) => [dim("  ".repeat(1 + Math.min(a.depth, 3))), seg(String(a.role ?? a.id).padEnd(30)), seg(String(a.mode ?? a.outcome ?? "ended").padEnd(18), a.mode ? "info" : "subtle"), dim(`${a.id} · ${a.lifecycle}${a.outcome ? ` ${a.outcome}` : ""} · ${a.provider}${a.dispatch === "serial" ? " (serial)" : ""}`)];

const unitLine = (u) => [dim("  "), seg(u.id.padEnd(7)), seg(u.state.padEnd(11), TONE_OF_STATE[u.state]), seg(`${u.kind} `), dim(u.objective ?? "")];

const factoryLine = (f) => [dim("  "), seg(String(f.word).padEnd(22), "brand"), seg(String(f.name ?? f.pin ?? ""))];

const actionLine = (a) => [dim("  "), seg(String(a.agentRun ?? a.id).padEnd(7)), seg(String(a.operationKind).padEnd(20)), seg(String(a.mode).padEnd(16), "info"), seg(a.status, a.status === "AMBIGUOUS" ? "danger" : null)];

const evidenceLine = (a) => [dim("  "), seg(a.id.padEnd(7)), seg(String(a.level).padEnd(19), TONE_OF_LEVEL[a.level]), seg(a.verified ? "verified" : "not verified", a.verified ? "success" : "subtle"), dim(`  ${a.statement}`)];

const blockerLine = (b) => [dim("  "), seg(b.kind.padEnd(18), "warning"), seg(b.ref.padEnd(8)), dim(b.say ?? "")];

const BLOCKS = [
  (v) => [missionLine(v)],
  (v) => (v.graph.units.length ? [section("WORK UNITS"), ...v.graph.units.map(unitLine)] : []),
  (v) => (v.agents.length ? [section("AGENTS"), ...v.agents.map(agentLine)] : []),
  (v) => (v.factory.length ? [section("FACTORY ACTIVITY"), ...v.factory.filter((f) => !["ROLE_VALIDATED", "ROLE_REGISTERED", "TEMPLATE_REGISTERED"].includes(f.word)).slice(-8).map(factoryLine)] : []),
  (v) => (v.execution.open.length ? [section("EXECUTION"), ...v.execution.open.map(actionLine)] : []),
  (v) => (v.verification.acceptance.length ? [section("EVIDENCE"), ...v.verification.acceptance.map(evidenceLine)] : []),
  (v) => (v.verification.blockers.length ? [section("BLOCKERS"), ...v.verification.blockers.map(blockerLine)] : []),
  (v) => [[seg("Mission verdict: ", "label"), seg(VERDICT_SAY[v.mission.verdict] ?? v.mission.verdict)]],
];

// view: liveViewOf(...); viewer: viewerStateOf(...); opts: { columns, rows, colour }
export const screenLines = (view, viewer, opts = {}) => [header(view, viewer), ...BLOCKS.flatMap((b) => b(view))].slice(0, opts.rows ?? 200).map((segs) => drawn(segs, opts.columns ?? 100, opts.colour ?? false));
