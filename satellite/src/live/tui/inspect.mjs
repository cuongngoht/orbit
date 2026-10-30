// INSPECT one agent run (0.2.2, ADR 0044): everything the live view holds about the run a person selected in the
// Agents view -- which run it is, what it is pinned to, where it sits among its parent and children, the host agent
// that carries it and how anybody knows, what that agent was seen doing, and the records that stand behind it. A pure
// function of the live view: nothing here reads a file or a clock, and nothing decides -- every word is the engine's or
// the join's, shown as derived. A field nothing recorded says so.
import { dim, seg } from "../../../../src/live/tui/sections/parts.mjs";
import { TONE_OF_ATTRIBUTION } from "./views.mjs";

const CALLS_SHOWN = 12;

const pad = (text, n) => String(text ?? "—").padEnd(n);

const clockOf = (at) => String(at ?? "").slice(11, 19) || "--:--:--";

const field = (label, value, tone) => [dim(`  ${pad(label, 14)}`), seg(value ?? "not recorded", value ? tone : "subtle")];

const title = (text, extra) => [seg(text, "label"), dim(extra ? `  ${extra}` : "")];

const parentWords = (a) => (!a.parentRef ? "none: dispatched by the mission" : a.parentRef.known ? a.parentRef.id : `${a.parentRef.id}, which is not in this mission's journal`);

const lifeWords = (h) => (h?.startedAt || h?.endedAt ? `${h.startedAt ? `started ${clockOf(h.startedAt)}` : "no start seen"} · ${h.endedAt ? `stopped ${clockOf(h.endedAt)}` : "no stop seen"}` : null);

const okWord = (ok) => (ok === true ? "ok" : ok === false ? "failed" : "not reported");

const callRow = (c) => [dim(`  ${clockOf(c.at)}  `), seg(pad(c.kind, 9)), seg(pad(c.what ?? "", 34)), seg(okWord(c.ok), c.ok === false ? "danger" : "subtle")];

const runRows = (a) => [
  title(`RUN ${a.id}`, a.ref ?? ""),
  field("role", a.role ? `${a.role} (${a.pins?.role ?? a.rolePin ?? "no pin"})` : null),
  field("template", a.pins?.template),
  field("skills", (a.pins?.skills ?? []).join(", ") || null),
  field("unit", `${a.unit}: ${a.objective ?? ""}`),
  field("parent", parentWords(a), a.parentRef && !a.parentRef.known ? "warning" : undefined),
  field("children", a.children.join(", ") || "none"),
  field("dispatch", `${a.dispatch}${a.dispatch === "serial" ? " (one run at a time, in the session itself)" : ""} · ${a.profile} · attempt ${a.attempt}`),
  field("mode", a.mode ? [a.baseMode, ...a.modes].filter(Boolean).join(" › ") : "ended"),
  field("lifecycle", `${a.lifecycle}${a.outcome ? ` · ${a.outcome}` : ""}`),
  field("provider", `${a.provider}${a.providerRef ? ` · ${a.providerRef}` : ""}`),
  ...(a.task ? [field("task", `task:${a.task} (its actions are bound to the run by Orbit: RUNTIME_BOUND)`, "success")] : []),
];

const hostRows = (a) => [
  [],
  title("HOST AGENT", "how anybody knows which agent carries this run"),
  field("attribution", a.attribution ?? "UNATTRIBUTED", TONE_OF_ATTRIBUTION[a.attribution]),
  field("because", a.basis),
  field("host agent", a.hostAgent),
  ...((a.named ?? []).length > 1 ? [field("named", a.named.join(", "), "danger")] : []),
  field("host says", lifeWords(a.hostLifecycle)),
  field("calls", `${a.counts?.direct ?? 0} direct · ${a.counts?.descendants ?? 0} through the agents it launched · ${a.counts?.failed ?? 0} failed · ${a.counts?.unknown ?? 0} not reported`),
  field("launched", (a.hostChildren ?? []).join(", ") || null),
];

const callsRows = (a) => [[], title("ITS CALLS", "direct, newest first, as the hooks saw them"), ...((a.calls ?? []).length ? a.calls.slice(0, CALLS_SHOWN).map(callRow) : [[dim("  none observed")]])];

const actionRowOf = (x) => [dim(`  ${pad(x.id, 8)}`), seg(pad(x.type, 17)), seg(pad(x.status, 19)), dim(`${x.operationKind ?? ""}${x.level ? ` · ${x.level}` : ""}${x.providerRef ? ` · ${x.providerRef}` : ""}`)];

const handoffRowOf = (h) => [dim(`  ${pad(h.id, 8)}`), seg(pad(`${h.unit} → ${h.targets.join(", ") || "—"}`, 26)), dim(`digest ${String(h.digest ?? "").slice(0, 12)}${h.consumedBy.length ? ` · consumed by ${h.consumedBy.join(", ")}` : ""}`)];

const blockerRowOf = (b) => [dim(`  ${pad(b.kind, 18)}`), seg(pad(b.ref, 8), "warning"), dim(b.say ?? "")];

const actionsOf = (v, id) => [...v.execution.open, ...v.execution.recent].filter((x, i, all) => x.agentRun === id && all.findIndex((y) => y.id === x.id) === i);

const recordRows = (v, a) => [
  [],
  title("RECORDS", "what stands behind it: its actions, the handoffs it published, what blocks it"),
  ...actionsOf(v, a.id).map(actionRowOf),
  ...v.memory.handoffs.filter((h) => h.agentRun === a.id).map(handoffRowOf),
  ...v.verification.blockers.filter((b) => b.ref === a.id || actionsOf(v, a.id).some((x) => x.id === b.ref)).map(blockerRowOf),
];

const closing = [[], [dim("  enter, o or esc closes this · a run is inspected, never changed, from here")]];

// view: liveViewOf(...); id: the selected run, or null.
export const inspectRows = (view, id) => ((a) => (a ? [...runRows(a), ...hostRows(a), ...callsRows(a), ...recordRows(view, a), ...closing] : [[dim("  select a run in the Agents view (2) with j and k, then press enter")]]))(view.agents.find((x) => x.id === id) ?? null);
