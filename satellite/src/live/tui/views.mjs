// THE NINE VIEWS of Satellite Live's full screen: each a pure function from the live view (src/live/view.mjs) to rows
// of segments -- what the journal holds, drawn, and nothing it does not. Nothing here reads a clock, a file or a key,
// and a view decides nothing: a level, a lifecycle, a mode and a status are the engine's words, shown as derived.
// The order is the key a person presses:
//
//   1 Mission · 2 Agents · 3 Roles · 4 Skills · 5 Workflows · 6 Tools · 7 Memory · 8 Timeline · 9 Verification
import { dim, seg } from "../../../../src/live/tui/sections/parts.mjs";
import { TONE_OF_HYPOTHESIS, TONE_OF_LEVEL, TONE_OF_STATE, TONE_OF_STATUS, VERDICT_SAY } from "../tones.mjs";

const pad = (text, n) => String(text ?? "—").padEnd(n);

const clockOf = (at) => String(at ?? "").slice(11, 19) || "--:--:--";

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
//
// 0.2.2 (ADR 0044): under each run, the host agent that carries it and the word that says how anybody knows
// (src/attribution.mjs), the host's own lifecycle of that agent, and the calls it made -- direct, and through the agents
// it launched, counted apart. The selected run (j/k) is marked; enter or o inspects it.

const subtree = (byId, a) => [a, ...a.children.map((c) => byId.get(c)).filter(Boolean).flatMap((c) => subtree(byId, c))];

export const treeOf = (agents) => ((byId) => agents.filter((a) => !a.parent || !byId.has(a.parent)).flatMap((a) => subtree(byId, a)))(new Map(agents.map((a) => [a.id, a])));

export const TONE_OF_ATTRIBUTION = Object.freeze({ RUNTIME_BOUND: "success", HOST_OBSERVED: "info", REPORTED: "warning", UNATTRIBUTED: "subtle", CONFLICTING: "danger" });

// The run's own mode, and a nested action's on top of it while it is open: EXPLORING › DISPATCHING.
const modeOf = (a) => (a.mode ? [a.baseMode, ...a.modes].filter(Boolean).join(" › ") : a.outcome ?? "ended");

const indent = (a, more = 0) => dim("  ".repeat(1 + more + Math.min(a.depth, 3)));

const marked = (a, s) => (s?.selected === a.id ? seg("▶ ", "selected") : dim("  "));

const agentRow = (a, s) => Object.assign([indent(a), marked(a, s), seg(pad(a.id, 7), s?.selected === a.id ? "selected" : undefined), seg(pad(a.role, 28)), seg(pad(modeOf(a), 28), a.mode ? "info" : "subtle"), seg(pad(a.lifecycle, 11)), dim(`${a.provider}${a.dispatch === "serial" ? " · serial" : ""} · ${a.profile} · attempt ${a.attempt}${a.providerRef ? ` · ${a.providerRef}` : ""}`)], { run: a.id });

const agentUnitRow = (a) => [indent(a, 1), dim(`└ ${a.unit}: ${a.objective ?? ""}`)];

const shortAgent = (id) => String(id ?? "").slice(-8);

const countsWords = (a) => `${a.counts?.direct ?? 0} call(s)${a.counts?.descendants ? ` · ${a.counts.descendants} through the agents it launched` : ""}`;

const hostWords = (a) => (a.hostAgent ? `host agent ${shortAgent(a.hostAgent)} · ${countsWords(a)}${a.hostLifecycle?.endedAt ? " · the host says it stopped" : a.hostLifecycle?.startedAt ? " · the host says it started" : ""}` : a.basis ?? "no trail was read");

const agentHostRow = (a) => [indent(a, 1), dim("└ "), seg(pad(a.attribution ?? "UNATTRIBUTED", 14), TONE_OF_ATTRIBUTION[a.attribution] ?? "subtle"), dim(hostWords(a))];

const orphanRow = (a) => (a.parentRef && !a.parentRef.known ? [[indent(a, 1), seg(`└ parent ${a.parentRef.id} is not in this mission's journal: drawn at the top, never under another run`, "warning")]] : []);

const agentsRows = (v, s) => block(["AGENT RUNS", `${v.agents.filter((a) => a.mode).length} open · ${v.agents.filter((a) => !a.mode).length} ended · j/k select · enter inspect`], treeOf(v.agents).flatMap((a) => [agentRow(a, s), agentUnitRow(a), agentHostRow(a), ...orphanRow(a)]), "no agent run yet");

// ---- 3 Roles · 4 Skills · 5 Workflows: what each factory generated, reused, validated, registered, rejected ---------

const factoryRow = (f) => [dim("  "), seg(pad(f.word, 22), /REJECTED$/.test(f.word) ? "danger" : "brand"), seg(pad(f.name, 30)), dim(`${f.pin ?? ""}${f.unit ? ` · ${f.unit}` : ""}${f.findings.length ? ` · ${f.findings.length} finding(s)` : ""}`)];

const ofKinds = (v, prefix) => v.factory.filter((f) => f.kind.startsWith(prefix)).map(factoryRow);

const rolesRows = (v) => [...block(["ROLE FACTORY"], ofKinds(v, "role."), "no role resolved yet"), ...block(["AGENT TEMPLATES"], ofKinds(v, "template."), "no template resolved yet")];

const skillsRows = (v) => block(["SKILL FACTORY"], ofKinds(v, "skill."), "no skill discovered, generated or reused yet");

const workflowsRows = (v) => block(["WORKFLOW TEMPLATES"], ofKinds(v, "workflow."), "no workflow resolved yet");

// ---- 6 Tools: what is executing, through which gate, in which mode -- and what the host's own tool calls are -----

const actionRow = (a) => [dim("  "), seg(pad(a.id, 7)), seg(pad(a.type, 17)), seg(pad(a.operationKind, 20)), seg(pad(a.mode, 17), "info"), seg(pad(a.status, 19), TONE_OF_STATUS[a.status]), dim(`${a.provider}${a.agentRun ? ` · ${a.agentRun}` : ""}${a.parent ? ` ⊂ ${a.parent}` : ""}${a.level ? ` · ${a.level}` : ""}${a.providerRef ? ` · ${a.providerRef}` : ""}`)];

const toolCallRows = (v) => v.agents.map((a) => [dim("  "), seg(pad(a.id, 9)), seg(pad(a.attribution ?? "UNATTRIBUTED", 14), TONE_OF_ATTRIBUTION[a.attribution] ?? "subtle"), dim(a.hostAgent ? `${countsWords(a)} by host agent ${shortAgent(a.hostAgent)}` : a.basis ?? "")]);

// Why a viewer shows none of this session's tool calls, in the source's own word.
const SESSION_SAY = Object.freeze({ off: "the working set is switched off here (ORBIT_WORKING_SET=off)", "no-session": "this viewer has no session mark, so no session's calls are read", "no-project": "no project here keeps a working set", unreadable: "this session's working set could not be read" });

const okWord = (ok) => (ok === true ? "ok" : ok === false ? "failed" : "");

const sessionRow = (e) => [dim(`  ${clockOf(e.at)}  `), seg(pad(e.kind, 9)), seg(pad(e.what ?? e.class ?? "", 40)), seg(okWord(e.ok), e.ok === false ? "danger" : "subtle")];

// The session's OWN calls -- the ones no payload named an agent for -- since 0.2.2; a viewer of an older activity reads
// every call it has.
const ownOf = (s) => s.own ?? { observed: s.observed, running: s.running, recent: s.recent };

const sessionRows = (s) => (!s ? [none("not read by this viewer")] : s.source !== "ok" ? [none(SESSION_SAY[s.source] ?? s.source)] : ownOf(s).recent.map(sessionRow));

const sessionTitle = (s) => (s?.source === "ok" ? `${ownOf(s).observed} observed${s.partial ? " lately" : ""} · ${ownOf(s).running} running · UNATTRIBUTED: attributed to no agent run` : "UNATTRIBUTED: attributed to no agent run");

const unboundRow = (g) => [dim("  "), seg(pad(g.type ?? "an agent", 28)), seg(pad(shortAgent(g.agent), 10)), dim(`${g.lifecycle ?? "seen"} · ${g.observed} call(s)${g.run ? ` · its call named ${g.run}, which this mission does not bind` : ""}`)];

const TRAIL_WORDS = { ok: "read", off: "switched off here (ORBIT_TRACE=off): no launch can be observed", unreadable: "could not be read", none: "not read by this viewer" };

const coverageRows = (c) => [[dim("  "), seg(pad("session trail", 16)), dim(TRAIL_WORDS[c?.trail] ?? String(c?.trail))], [dim("  "), seg(pad("this host", 16)), dim(c?.host?.agents ?? "what it lets the hooks see about an agent is not known here")], [dim("  "), seg(pad("counted from", 16)), dim(`${c?.basis ?? ""}${c?.partial ? " (the tail of a longer session)" : ""}`)]];

const toolsRows = (v) => [
  ...block(["EXECUTING NOW", `${v.execution.open.length} open`], v.execution.open.map(actionRow), "nothing is executing"),
  ...block(["RECENT ACTIONS", "newest first"], [...v.execution.recent].reverse().map(actionRow), "no action yet"),
  ...block(["TOOL CALLS BY AGENT RUN", "direct · through the agents it launched, counted apart"], toolCallRows(v), "no agent run yet"),
  ...block(["THIS SESSION'S OWN TOOL CALLS", sessionTitle(v.tools.session)], sessionRows(v.tools.session), "none observed yet"),
  ...block(["AGENTS THE HOOKS SAW THAT NO RUN IS BOUND TO"], (v.tools.session?.unbound ?? []).map(unboundRow), "none"),
  ...block(["COVERAGE"], coverageRows(v.tools.coverage), "not read"),
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
