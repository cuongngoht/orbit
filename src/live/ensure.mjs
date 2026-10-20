// ENSURE A VIEWER: what `/orbit` and `/orbit-help` (and a workflow's start) do about Orbit Live, decided as tables (ADR 0020).
// Opening a viewer is PRESENTATION: it grants nothing -- no automation, no approval, no sandbox, no run -- and a
// viewer that cannot be opened never stops the work it would have shown.
//
//   POLICY  why nothing opens by itself here, in order; the first row that holds is the answer. The person's
//           switches first (Live off for this host, the automation settings unreadable, live.open off, Live display
//           off), then whether anybody is at the session as the HOST says it (never a guess from a terminal), and
//           whether there is a checkout and a session mark to bind a viewer to.
//   RULES   what to do about this session's lease (src/live/lease.mjs), in order: reuse the viewer that is open,
//           offer a new task to a viewer whose task a person picked, tell it to show the task, wait for one being
//           opened, refuse to bring back a viewer a person closed when it is a workflow (not the person) asking, say
//           that nothing here can open one, or open one. Whether anything here CAN open a pane is asked only when one
//           would be opened: a viewer already open -- a pane a host docks beside the session (`live pane`) -- is
//           ALREADY_ATTACHED in a terminal that could open nothing.
//   STATUS  every word an answer can carry: whether a viewer is believed open after it, and the sentence said.
//
//   policyRefusal(facts) -> { status, why } | null
//   switchRefusal(facts) -> { status, why } | null     the person's switches alone: what a docked pane honours
//   leaseRule(liveness, request, lease) -> { act, status, why }
//   answerOf(status, extra) -> { status, opened, say, ... }
//
//   facts:   { live, settings: { open, display } | null, attended, checkout, key, opener }
//   request: { entry: "help" | "workflow", task: <tsk-…> | null, opener, prints, where }
//            prints  the opener here can only print the command (src/live/ensure.mjs never names one); `where` says why
//            help      a person invoked /orbit or /orbit-help (or `live ensure` in a terminal): may open again what was closed
//            workflow  a coordinated workflow started or picked one up: never brings back a viewer that was closed
export const ENTRIES = Object.freeze(["help", "workflow"]);

export const STATUS = Object.freeze({
  OPENED: { opened: true, say: "Orbit Live opened beside this session; it stays until you leave it with q" },
  REOPENED: { opened: true, say: "Orbit Live opened again beside this session (the session's previous viewer had left)" },
  STARTING: { opened: false, say: "Orbit Live was asked to open beside this session and has not said it is ready yet" },
  ALREADY_ATTACHED: { opened: true, say: "this session's Orbit Live viewer is open" },
  SELECTED: { opened: true, say: "this session's Orbit Live viewer was told to show the task" },
  HELD: { opened: true, say: "this session's Orbit Live viewer shows a task a person picked; the new task is offered there (t picks it)" },
  NOT_REOPENED: { opened: false, say: "this session's viewer was closed; /orbit, /orbit-help or `live open` brings it back" },
  DISABLED_BY_POLICY: { opened: false, say: "Orbit Live does not open by itself here" },
  HEADLESS_FALLBACK: { opened: false, say: "Orbit Live does not open by itself in this session" },
  UNSUPPORTED_TERMINAL: { opened: false, say: "Orbit Live cannot open a pane or a window from here" },
  NOT_A_CHECKOUT: { opened: false, say: "Orbit Live has no checkout to follow here" },
  LAUNCH_FAILED: { opened: false, say: "Orbit Live could not be opened" },
});

export const STATUS_NAMES = Object.freeze(Object.keys(STATUS));

export const POLICY = Object.freeze([
  { status: "DISABLED_BY_POLICY", when: (f) => f.live === false, why: "Live is switched off for this host (the plugin's live option, or ORBIT_LIVE=off)" },
  { status: "DISABLED_BY_POLICY", when: (f) => !f.settings, why: "the automation settings could not be read, so nothing opens by itself (Orbit Control › Automation says why)" },
  { status: "DISABLED_BY_POLICY", when: (f) => f.settings.open !== true, why: "opening it by itself is switched off (Orbit Control › Automation › Live)" },
  { status: "DISABLED_BY_POLICY", when: (f) => f.settings.display === "off", why: "Live display is off (Orbit Control › Automation › Live)" },
  { status: "HEADLESS_FALLBACK", when: (f) => f.attended !== true, why: "the host does not say a person is at this session (a headless run, CI, or a host whose attendance Orbit has not verified)" },
  { status: "NOT_A_CHECKOUT", when: (f) => !f.checkout, why: "this directory is not inside a repository" },
  { status: "HEADLESS_FALLBACK", when: (f) => !f.key, why: "this shell carries no session mark, so a viewer cannot be bound to this session" },
]);

const refusalOf = (rows, facts) => ((row) => (row ? { status: row.status, why: row.why } : null))(rows.find((r) => r.when(facts)));

export const policyRefusal = (facts) => refusalOf(POLICY, facts);

// The rows that are a person's word, not a fact about this session: a pane the host docks (and draws only where a
// person is) honours these and asks nothing else.
export const SWITCHES = Object.freeze(POLICY.filter((r) => r.status === "DISABLED_BY_POLICY"));

export const switchRefusal = (facts) => refusalOf(SWITCHES, facts);

const showing = (lease, req) => !req.task || lease?.shows === req.task;

export const RULES = Object.freeze([
  { act: "keep", status: "ALREADY_ATTACHED", when: (live, req, lease) => live.state === "attached" && showing(lease, req) },
  { act: "select", status: "HELD", when: (live, req, lease) => live.state === "attached" && lease?.picked === true },
  { act: "select", status: "SELECTED", when: (live) => live.state === "attached" },
  { act: "select", status: "STARTING", when: (live) => live.state === "starting" },
  { act: "keep", status: "NOT_REOPENED", when: (live, req) => req.entry === "workflow" && live.state !== "none" },
  { act: "refuse", status: "UNSUPPORTED_TERMINAL", when: (live, req) => req.prints === true || req.opener === "print", why: (req) => req.where ?? "no tmux pane, no Windows Terminal, not macOS, or a remote shell" },
  { act: "open", status: "OPENED", when: (live) => live.state === "none" },
  { act: "open", status: "REOPENED", when: () => true },
]);

const whyOf = (row, req) => (typeof row.why === "function" ? row.why(req) : row.why ?? null);

export const leaseRule = (live, req, lease) => ((row) => ({ act: row.act, status: row.status, why: whyOf(row, req) }))(RULES.find((r) => r.when(live, req, lease)));

export const answerOf = (status, extra = {}) => ({ status, opened: STATUS[status].opened, say: extra.why ? `${STATUS[status].say}: ${extra.why}` : STATUS[status].say, ...extra });
