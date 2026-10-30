// THIS SESSION's activity in a pane (1.8.7): the rows a viewer draws from src/live/session.mjs -- what the host's hooks
// observed this session's tools do -- when no task's journal speaks for the work (a /orbit-help that went the
// developer's way), and the one `session` line it adds beside a task while the host works a step itself. Every row
// says it is OBSERVED tool activity: a command that ended well "ended ok", never PASSED, and no count here is a
// progress. When there is nothing, the row says WHY (SESSION_SOURCE_WORDS), never an empty block. Pure.
//
//   sessionOf(ctx) -> activity | null
//   sessionNowRows(ctx, narrow) -> [row]      task (none, or the ones to choose from) · running · last · files · checks
//   sessionLine(ctx, since) -> [seg] | null   the newest thing this session did at or after `since`
//   sessionViewRows(ctx, id) -> [row] | null  events · tests · changes, from this session; null for any other view
//   sessionBarOf(ctx) -> row                  the counts, and the session's own indicator on the right
//   sessionIndicator(activity) -> indicator   the shape indicator.mjs answers, of the TOOLS' state, never a task's
//
// WHICH AGENT (0.2.2, ADR 0044): where the host's payload names the subagent that made a call, NOW says how many agents
// the hooks saw and what each is doing, and the events view draws one block per agent -- its own calls under it -- above
// the session's own calls. A call no payload attributed to an agent is never drawn under one, and the coverage line says
// what this host lets the hooks see.
import { SESSION_KIND_WORDS, SESSION_SOURCE_WORDS, SESSION_WORDS, STATUS_WORDS } from "../words.mjs";
import { clock, dim, joined, labelled, row, seg } from "./sections/parts.mjs";

export const SESSION_NOW_ITEMS = 3;

export const sessionOf = (ctx) => ctx.state.session ?? null;

const has = (a) => Boolean(a) && (a.observed > 0 || a.running.length > 0);

const RESULTS = [
  { when: (e) => e.bg, segs: () => [dim("started in the background; its end is not observed")] },
  { when: (e) => e.ok === true, segs: () => [seg("✓ ", "success"), dim("ended ok")] },
  { when: (e) => e.ok === false, segs: () => [seg("✗ ", "danger"), seg("ended with an error", "danger")] },
  { when: () => true, segs: () => [dim("its result was not reported")] },
];

const resultSegs = (e) => RESULTS.find((r) => r.when(e)).segs(e);

const doneSegs = (e) => [seg(`${SESSION_KIND_WORDS[e.kind] ?? SESSION_KIND_WORDS.other} `), seg(e.what ?? "", "label")];

const runningSegs = (e) => [seg(`${STATUS_WORDS.RUNNING.glyph} `, STATUS_WORDS.RUNNING.tone), seg(e.what ?? "a command", "label"), dim(`  since ${clock(e.at)} UTC · no result yet`)];

// A tail read says how many calls it SAW, never the session's total.
const countWords = (a) => `${a.observed} ${a.partial ? "recent " : ""}tool calls`;

const listed = (items, n) => `${items.slice(0, n).join(", ")}${items.length > n ? ` +${items.length - n} more` : ""}`;

const checkWords = (e) => `${e.what} ${e.bg ? "(background)" : e.ok === true ? "✓" : e.ok === false ? "✗" : "?"}`;

// Which task, said plainly: none, or the ones a person must choose between (association.mjs AMBIGUOUS).
const TASK_ROWS = [
  { when: (c) => c.association?.how === "ambiguous", segs: (c) => [seg(`${c.association.ids.length} tasks run in this checkout, none chosen`, "warning"), dim(` — live pin <task> picks one: ${c.association.ids.join(", ")}`)] },
  { when: () => true, segs: () => [dim("none — this is the session's tool activity, observed by the host's hooks")] },
];

// One agent, said plainly: its type, the host's word for where it stands, what it was seen doing, and who launched it.
const AGENT_WORDS = { STARTED: { word: "started", tone: "info" }, ENDED: { word: "ended", tone: "subtle" }, SEEN: { word: "seen", tone: "subtle" } };

const shortId = (id) => String(id ?? "").slice(-8);

const launcherWords = (g) => (g.by === "session" ? "launched by the session" : g.by ? `launched by ${shortId(g.by)}` : null);

const agentSegs = (g) => joined([seg(g.type ?? "an agent", "label"), dim(shortId(g.agent)), seg(AGENT_WORDS[g.lifecycle]?.word ?? g.lifecycle, AGENT_WORDS[g.lifecycle]?.tone), dim(`${g.observed} call${g.observed === 1 ? "" : "s"}`), g.running.length ? seg(`${g.running.length} running`, "info") : null, launcherWords(g) ? dim(launcherWords(g)) : null, g.run ? dim(`run ${g.run}`) : null]);

const agentsNow = (a) => (a?.agents?.length ? [seg(`${a.agents.length + (a.agentsCut ?? 0)} subagent${a.agents.length + (a.agentsCut ?? 0) === 1 ? "" : "s"}`), dim(" · "), ...agentSegs(a.agents.at(-1))] : null);

// What this host lets the hooks see about WHICH agent made a call (src/work/track/coverage.mjs, handed in as data).
const COVERAGE_ROWS = [
  { when: (c) => !c, segs: () => null },
  { when: (c) => c.namesAgents === true, segs: () => [dim("a subagent's calls are named by the host; the rest are the session's own")] },
  { when: (c) => c.namesAgents === false, segs: () => [seg("this host names no subagent: a call cannot be attributed to one", "warning")] },
  { when: () => true, segs: () => [seg("whether this host names a subagent's calls is not known: calls are unattributed", "warning")] },
];

const coverageSegs = (a) => COVERAGE_ROWS.find((r) => r.when(a?.coverage ?? null)).segs(a?.coverage ?? null);

const NOW = [
  { label: "task", narrow: true, segs: (c) => TASK_ROWS.find((r) => r.when(c)).segs(c) },
  { label: "activity", narrow: true, segs: (c) => (has(c.a) ? null : [dim(SESSION_SOURCE_WORDS[c.a?.source ?? "ok"] ?? SESSION_SOURCE_WORDS.ok)]) },
  { label: "running", narrow: true, segs: (c) => (c.a?.running.length ? runningSegs(c.a.running.at(-1)) : null) },
  { label: "last", narrow: true, segs: (c) => (c.a?.recent[0] ? [...doneSegs(c.a.recent[0]), dim("  "), ...resultSegs(c.a.recent[0])] : null) },
  { label: "files", narrow: false, segs: (c) => (c.a?.files.length ? [seg(listed(c.a.files, SESSION_NOW_ITEMS))] : null) },
  { label: "checks", narrow: false, segs: (c) => (c.a?.checks.length ? [seg(listed(c.a.checks.map(checkWords), SESSION_NOW_ITEMS))] : null) },
  { label: "observed", narrow: false, segs: (c) => (has(c.a) ? [dim(`${countWords(c.a)} · ${c.a.files.length} files changed · ${c.a.checks.length} checks · observed by the host's hooks`)] : null) },
  { label: "agents", narrow: true, segs: (c) => agentsNow(c.a) },
  { label: "coverage", narrow: false, segs: (c) => (has(c.a) ? coverageSegs(c.a) : null) },
];

export function sessionNowRows(ctx, narrow = false) {
  const c = { a: sessionOf(ctx), association: ctx.state.association };
  return NOW.filter((f) => !narrow || f.narrow).map((f) => ({ f, segs: f.segs(c) })).filter((x) => x.segs?.length).map((x) => labelled(x.f.label, x.segs));
}

// ---- beside a task: what this session's own tools did while it ran ----------------------------------------------

const atOrAfter = (since) => (e) => !since || e.at >= since;

export function sessionLine(ctx, since) {
  const a = sessionOf(ctx);
  const running = (a?.running ?? []).filter(atOrAfter(since)).at(-1);
  const last = (a?.recent ?? []).filter(atOrAfter(since))[0];
  return running ? [...runningSegs(running), dim("  observed")] : last ? [...doneSegs(last), dim("  "), ...resultSegs(last), dim("  observed")] : null;
}

// ---- the views -------------------------------------------------------------------------------------------------

const timeSeg = (e) => dim(`${clock(e.at)}  `);

const eventRow = (e) => row([timeSeg(e), ...doneSegs(e)], resultSegs(e));

const runningRow = (e) => row([timeSeg(e), ...runningSegs(e)]);

const fileRow = (p) => row([seg("M ", "info"), seg(p)], [dim("edited")]);

const empty = (a) => [row([dim(SESSION_SOURCE_WORDS[a?.source ?? "ok"] ?? SESSION_SOURCE_WORDS.ok)])];

const CHECKS_SAY = "commands named like a build, test or lint, observed by the host's hooks: how each ended, never what a test proved";

// An agent's block: its head, then its own calls -- running first, then the newest -- indented under it.
const agentBlock = (g) => [row([seg("▸ "), ...agentSegs(g)], [dim("host-observed")]), ...g.running.map((e) => ({ ...runningRow(e), depth: 1 })), ...g.recent.map((e) => ({ ...eventRow(e), depth: 1 }))];

const OWN_SAY = { HOST_OBSERVED: "THE SESSION'S OWN CALLS", UNATTRIBUTED: "UNATTRIBUTED · calls no payload named an agent for" };

const ownBlock = (a) => [row([dim(OWN_SAY[a.own?.attribution] ?? OWN_SAY.UNATTRIBUTED)]), ...(a.own?.running ?? []).map(runningRow), ...(a.own?.recent ?? []).map(eventRow)];

const agentsMore = (a) => (a.agentsCut ? [row([dim(`${a.agentsCut} earlier subagent(s) not shown: \`trace usage\` counts every one`)])] : []);

const byAgentRows = (a) => [row([seg("AGENTS", "label"), dim(" · host-observed")]), ...agentsMore(a), ...a.agents.flatMap(agentBlock), ...ownBlock(a)];

const eventsRows = (a) => (a.agents?.length ? byAgentRows(a) : [...a.running.map(runningRow), ...a.recent.map(eventRow)]);

const VIEWS = {
  events: (a) => (has(a) ? eventsRows(a) : empty(a)),
  tests: (a) => (a?.checks.length || a?.running.length ? [row([dim(CHECKS_SAY)]), ...a.running.filter((e) => e.class !== "other").map(runningRow), ...a.checks.map(eventRow)] : [row([dim("no build, test or lint has run in this session yet")])]),
  changes: (a) => (a?.files.length ? a.files.map(fileRow) : [row([dim("no file changed in this session yet")])]),
};

export const sessionViewRows = (ctx, id) => (VIEWS[id] ? VIEWS[id](sessionOf(ctx)) : null);

// ---- the status bar and its indicator ------------------------------------------------------------------------------

export function sessionIndicator(a) {
  const state = SESSION_WORDS[a?.state] ? a.state : "NONE";
  const w = SESSION_WORDS[state];
  return { state: `SESSION_${state}`, word: w.word, glyph: w.glyph, tone: w.tone, pulse: null, animate: false, fresh: false, evidence: a?.lastAt ? "session" : null, since: null };
}

const barParts = (a) => (has(a) ? [seg(`SESSION ${countWords(a)}`), seg(`${a.files.length} files`), seg(`${a.checks.length} checks`), a.running.length ? seg(`${a.running.length} running`, "info") : null] : [dim("no task · no activity observed yet")]);

export const sessionBarOf = (ctx) => ((a, i) => row(joined(barParts(a), "  ·  "), [seg(`${i.glyph} ${i.word}`, i.tone)]))(sessionOf(ctx), sessionIndicator(sessionOf(ctx)));
