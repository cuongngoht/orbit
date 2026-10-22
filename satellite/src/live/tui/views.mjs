// THE NINE VIEWS of Satellite Live's full screen: each a pure function from the live view (src/live/view.mjs) to rows
// of segments -- what the journal holds, drawn, and nothing it does not. Nothing here reads a clock, a file or a key,
// and a view decides nothing: a level, a lifecycle, a mode and a status are the engine's words, shown as derived.
// The order is the key a person presses:
//
//   1 Mission · 2 Agents · 3 Roles · 4 Skills · 5 Workflows · 6 Tools · 7 Memory · 8 Timeline · 9 Verification
import { dim, seg } from "../../../../src/live/tui/sections/parts.mjs";
import { TONE_OF_HYPOTHESIS, TONE_OF_LEVEL, TONE_OF_STATE, TONE_OF_STATUS, VERDICT_SAY } from "../tones.mjs";

const pad = (text, n) => String(text ?? "—").padEnd(n);

const title = (text, extra) => [seg(text, "label"), dim(extra ? `  ${extra}` : "")];

const none = (say) => [dim(`  ${say}`)];

// A titled block: its rows, or one line saying there is nothing yet -- never an empty heading.
const block = (heading, rows, empty) => [title(heading[0], heading[1]), ...(rows.length ? rows : [none(empty)]), []];

const verdictTone = (verdict) => (verdict === "VERIFIED" ? "success" : verdict === "NOT_VERIFIED" ? "warning" : "subtle");

// ---- 1 Mission: what was asked, where it stands, and the work graph with every revision of it -------------------

const unitRow = (u) => [dim("  "), seg(pad(u.id, 7)), seg(pad(u.state, 11), TONE_OF_STATE[u.state]), seg(pad(u.kind, 15)), seg(u.objective ?? ""), dim(u.deps.length ? `  after ${u.deps.join(", ")}` : ""), dim(`  · gate ${u.gate?.min ?? "—"}/${u.gate?.owner ?? "any"} · attempts ${u.attempts}`)];

const revisionRow = (r) => [dim("  "), seg(pad(`rev ${r.rev}`, 8)), seg(pad(r.cause ?? "first plan", 24)), dim(`affected ${r.affected.join(", ") || "—"} · invalidated ${r.invalidated.length} · cancelled ${r.cancelled.length}`)];

const triggerRow = (t) => [dim("  "), seg(pad(t.trigger, 24), "warning"), seg(`→ ${t.response}`), dim(t.unit ? `  ${t.unit}` : "")];

const missionRows = (v) => [
  [seg("MISSION  ", "label"), seg(v.mission.objective ?? "")],
  [dim("  "), seg(v.mission.lifecycle, "brand"), dim(" · "), seg(VERDICT_SAY[v.mission.verdict] ?? v.mission.verdict, verdictTone(v.mission.verdict)), dim(` · revision ${v.mission.revision}${v.mission.stop ? ` · stopped: ${[v.mission.stop].flat().join(", ")}` : ""}`)],
  [],
  ...block(["WORK GRAPH", `${v.graph.units.length} unit(s)`], v.graph.units.map(unitRow), "no plan yet"),
  ...block(["PLAN REVISIONS"], v.graph.revisions.map(revisionRow), "none yet"),
  ...block(["REPLANNING TRIGGERS"], v.graph.triggers.map(triggerRow), "none fired"),
];

// ---- 2 Agents: every run, children under their parent, each in ITS OWN mode -------------------------------------

const subtree = (byId, a) => [a, ...a.children.map((c) => byId.get(c)).filter(Boolean).flatMap((c) => subtree(byId, c))];

const treeOf = (agents) => ((byId) => agents.filter((a) => !a.parent || !byId.has(a.parent)).flatMap((a) => subtree(byId, a)))(new Map(agents.map((a) => [a.id, a])));

// The run's own mode, and a nested action's on top of it while it is open: EXPLORING › DISPATCHING.
const modeOf = (a) => (a.mode ? [a.baseMode, ...a.modes].filter(Boolean).join(" › ") : a.outcome ?? "ended");

const indent = (a, more = 0) => dim("  ".repeat(1 + more + Math.min(a.depth, 3)));

const agentRow = (a) => [indent(a), seg(pad(a.id, 7)), seg(pad(a.role, 28)), seg(pad(modeOf(a), 28), a.mode ? "info" : "subtle"), seg(pad(a.lifecycle, 11)), dim(`${a.provider}${a.dispatch === "serial" ? " · serial" : ""} · ${a.profile} · attempt ${a.attempt}${a.providerRef ? ` · ${a.providerRef}` : ""}`)];

const agentUnitRow = (a) => [indent(a, 1), dim(`└ ${a.unit}: ${a.objective ?? ""}`)];

const agentsRows = (v) => block(["AGENT RUNS", `${v.agents.filter((a) => a.mode).length} open · ${v.agents.filter((a) => !a.mode).length} ended`], treeOf(v.agents).flatMap((a) => [agentRow(a), agentUnitRow(a)]), "no agent run yet");

// ---- 3 Roles · 4 Skills · 5 Workflows: what each factory generated, reused, validated, registered, rejected ---------

const factoryRow = (f) => [dim("  "), seg(pad(f.word, 22), /REJECTED$/.test(f.word) ? "danger" : "brand"), seg(pad(f.name, 30)), dim(`${f.pin ?? ""}${f.unit ? ` · ${f.unit}` : ""}${f.findings.length ? ` · ${f.findings.length} finding(s)` : ""}`)];

const ofKinds = (v, prefix) => v.factory.filter((f) => f.kind.startsWith(prefix)).map(factoryRow);

const rolesRows = (v) => [...block(["ROLE FACTORY"], ofKinds(v, "role."), "no role resolved yet"), ...block(["AGENT TEMPLATES"], ofKinds(v, "template."), "no template resolved yet")];

const skillsRows = (v) => block(["SKILL FACTORY"], ofKinds(v, "skill."), "no skill discovered, generated or reused yet");

const workflowsRows = (v) => block(["WORKFLOW TEMPLATES"], ofKinds(v, "workflow."), "no workflow resolved yet");

// ---- 6 Tools: what is executing, through which gate, in which mode -- and what the host's own tool calls are -----

const actionRow = (a) => [dim("  "), seg(pad(a.id, 7)), seg(pad(a.type, 17)), seg(pad(a.operationKind, 20)), seg(pad(a.mode, 17), "info"), seg(pad(a.status, 19), TONE_OF_STATUS[a.status]), dim(`${a.provider}${a.agentRun ? ` · ${a.agentRun}` : ""}${a.parent ? ` ⊂ ${a.parent}` : ""}${a.level ? ` · ${a.level}` : ""}${a.providerRef ? ` · ${a.providerRef}` : ""}`)];

const toolCallRows = (v) => Object.entries(v.tools.byRun).map(([run, n]) => [dim("  "), seg(pad(run, 9)), dim(`${n} tool call(s) observed`)]);

const toolsRows = (v) => [
  ...block(["EXECUTING NOW", `${v.execution.open.length} open`], v.execution.open.map(actionRow), "nothing is executing"),
  ...block(["RECENT ACTIONS", "newest first"], [...v.execution.recent].reverse().map(actionRow), "no action yet"),
  ...block(["HOST TOOL CALLS"], toolCallRows(v), "no hook reports this host's tool calls here: which agent run made a call is UNOBSERVED"),
];

// ---- 7 Memory: what one unit handed the next, what was recalled, what is pinned, what was kept for recovery --------

const handoffRow = (h) => [dim("  "), seg(pad(h.id, 7)), seg(pad(`${h.unit} → ${h.targets.join(", ") || "—"}`, 24)), dim(`digest ${String(h.digest ?? "").slice(0, 12)} · consumed by ${h.consumedBy.join(", ") || "nobody yet"}${h.rejected.length ? ` · rejected: ${h.rejected.join(", ")}` : ""}${h.proposes ? " · proposes a change" : ""}`)];

const recallRow = (r) => [dim("  "), seg(pad(r.id, 7)), seg(pad(r.operationKind, 20)), seg(pad(r.status, 19), TONE_OF_STATUS[r.status]), dim(r.outcome ?? "")];

const pinRow = (kind) => (pin) => [dim("  "), seg(pad(kind, 10)), seg(pin)];

const checkpointRow = (c) => [dim("  "), seg(pad(`#${c.count}`, 7)), dim(`at revision ${c.revision}${c.file ? ` · ${c.file}` : ""}`)];

const memoryRows = (v) => [
  ...block(["HANDOFFS"], v.memory.handoffs.map(handoffRow), "none published"),
  ...block(["RECALLS"], v.memory.recalls.map(recallRow), "nothing recalled"),
  ...block(["PINNED DEFINITIONS"], [...v.memory.pinned.roles.map(pinRow("role")), ...v.memory.pinned.templates.map(pinRow("template")), ...v.memory.pinned.skills.map(pinRow("skill"))], "nothing pinned yet"),
  ...block(["CHECKPOINTS"], v.memory.checkpoints.map(checkpointRow), "none written"),
];

// ---- 8 Timeline: every event as orbit.satellite.event/v1 named it, by its sequence --------------------------------

const clockOf = (at) => String(at ?? "").slice(11, 19) || "--:--:--";

const eventRow = (e) => [dim(`  ${String(e.seq).padStart(4)}  ${clockOf(e.at)}  `), seg(pad(e.kind, 22)), seg(pad(e.mode ?? "", 17), "info"), seg(pad(e.agentRunId ?? "", 7)), dim(`${e.actionId ?? ""}${e.actionStatus ? ` ${e.actionStatus}` : ""}${e.parentActionId ? ` ⊂ ${e.parentActionId}` : ""}`)];

const timelineRows = (v) => block(["TIMELINE", `the last ${v.timeline.length} event(s), newest last`], v.timeline.map(eventRow), "no event yet");

// ---- 9 Verification: each criterion's evidence, each hypothesis, what is owed, what blocks ------------------------

const criterionRow = (a) => [dim("  "), seg(pad(a.id, 7)), seg(pad(a.level, 19), TONE_OF_LEVEL[a.level]), seg(pad(a.verified ? "verified" : "not verified", 14), a.verified ? "success" : "subtle"), dim(`${a.independent ? "independent · " : ""}${a.statement}`)];

const hypothesisRow = (h) => [dim("  "), seg(pad(h.id, 7)), seg(pad(h.status, 11), TONE_OF_HYPOTHESIS[h.status]), dim(h.statement)];

const owedRow = (o) => [dim("  "), seg(pad(o.acceptance, 7)), dim(`has ${o.has} · needs ${o.needs}`)];

const blockerRow = (b) => [dim("  "), seg(pad(b.kind, 18), "warning"), seg(pad(b.ref, 8)), dim(b.say ?? "")];

const verificationRows = (v) => [
  [seg("VERDICT  ", "label"), seg(VERDICT_SAY[v.mission.verdict] ?? v.mission.verdict, verdictTone(v.mission.verdict))],
  [],
  ...block(["ACCEPTANCE CRITERIA"], v.verification.acceptance.map(criterionRow), "none recorded"),
  ...block(["HYPOTHESES"], v.verification.hypotheses.map(hypothesisRow), "none recorded"),
  ...block(["OWED"], v.verification.owed.map(owedRow), "nothing owed"),
  ...block(["BLOCKERS"], v.verification.blockers.map(blockerRow), "none"),
];

export const VIEWS = Object.freeze([
  { id: "mission", key: "1", title: "Mission", rows: missionRows },
  { id: "agents", key: "2", title: "Agents", rows: agentsRows },
  { id: "roles", key: "3", title: "Roles", rows: rolesRows },
  { id: "skills", key: "4", title: "Skills", rows: skillsRows },
  { id: "workflows", key: "5", title: "Workflows", rows: workflowsRows },
  { id: "tools", key: "6", title: "Tools", rows: toolsRows },
  { id: "memory", key: "7", title: "Memory", rows: memoryRows },
  { id: "timeline", key: "8", title: "Timeline", rows: timelineRows },
  { id: "verification", key: "9", title: "Verification", rows: verificationRows },
]);

export const viewOf = (id) => VIEWS.find((v) => v.id === id) ?? VIEWS[0];
