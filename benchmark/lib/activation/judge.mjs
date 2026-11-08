// THE ACTIVATION JUDGE (0.5.0, B22 M4; the activation benchmark §5): what a host did with a prompt that named no skill,
// read off two sources that must agree -- the stream the controller captured (each Skill, Agent and Bash call, hostOf v2)
// and the trail Orbit's own hooks wrote (read back through `trace.mjs turns`) -- and held to the case's hidden truth by
// ordered tables whose last row always matches. It decides nothing from what a host SAID: a selection is behaviour, a
// router recommendation is not a selection, and a PASS rests on the owners' records and, for an outcome case, on the
// verifier's hidden checks.
//
//   observedOf(f) -> { activated, strategy, skills, agents, agentCalls, disabled, breaches, forbidden }
//   routerOf(turns, session) -> { version, strategy, path, top, injected, selected } | null
//   routerRight(router, truth) -> true | false | null        recordRows(f) -> [{ id, read, ok, says }]
//   judgedActivation(f) -> { verdict, row, class, why, observed, agreement, router, records, outcome, grounding, metric }
//   VERDICT · STRATEGY_SEEN · RECORDS · PLUGIN_COMMAND
//
//   f: { tier, arm, switches, truth, host: hostOf(stream), ran: { timedOut, error }, uses, commands, session,
//        trail: { turns, usage }, read: the inspection's documents, seed: { kept, digests, cases } | null,
//        outcome: { complete, held, problem, problemEnds, delivered } | null, tree: { rels, sizes } }
import { agreementOf, OURS } from "../core/agreement.mjs";
import { hostSession } from "../../../src/memory/session.mjs";
import { switchKey } from "../../../src/project/components.mjs";

// Where the plugin is in a round's container, as a host spells it: the mount, or the variable Claude Code sets.
const ROOT = String.raw`(?:/work/orbit|\$\{?CLAUDE_PLUGIN_ROOT\}?)/`;

// A command line that runs one of the plugin's own commands: what makes a Bash call Orbit's.
export const PLUGIN_COMMAND = new RegExp(`${ROOT}(?:satellite/)?cli/[a-z-]+\\.mjs\\b`);

const orbitCli = (name, rest = "") => new RegExp(`${ROOT}(?:satellite/)?cli/${name}\\.mjs["']?\\s+${rest}`);

const bare = (name) => String(name ?? "").split(":").at(-1);

const unique = (xs) => [...new Set(xs)];

const ran = (f, re) => (f.commands ?? []).some((c) => re.test(String(c.command ?? "")));

// ---- what the host did: the stream, and the trail's word on each call ----------------------------------------------------

const componentOf = (u) => (u.skill ? { kind: "skill", name: u.skill } : u.agent ? { kind: "agent", name: u.agent } : null);

const ours = (u) => Boolean(componentOf(u)) && OURS.test(componentOf(u).name);

// The session's own turns, as the trail keeps them.
const turnsOf = (f) => (f.trail?.turns?.json?.turns ?? []).filter((t) => !f.session || t.session === hostSession("claude", f.session));

const refusedInTrail = (f, c) => turnsOf(f).some((t) => (t.steps ?? []).some((s) => s.kind === c.kind && s.label === c.name && s.refused === true));

// A call the host's switch refused, and the stream agrees nothing ran: ATTEMPTED -- counted, never failed.
const attempted = (f, u) => refusedInTrail(f, componentOf(u)) && u.failed !== false;

const usedOf = (f) => (f.uses ?? []).filter(ours).filter((u) => !attempted(f, u));

const skillsOf = (f) => unique(usedOf(f).filter((u) => u.skill).map((u) => bare(u.skill)));

const agentCallsOf = (f) => usedOf(f).filter((u) => u.agent);

const countsOf = (calls) => calls.reduce((m, u) => ({ ...m, [bare(u.agent)]: (m[bare(u.agent)] ?? 0) + 1 }), {});

// A component the case switched off, by the key its switch reads (src/project/components.mjs) -- never by its name.
const switchedOff = (f, c) => ((key) => Boolean(key) && f.switches?.[`ORBIT_${key.toUpperCase()}`] === "off")(switchKey(c, "orbit"));

const disabledOf = (f) => (f.uses ?? []).filter(ours).filter((u) => switchedOff(f, componentOf(u))).map((u) => ({ kind: componentOf(u).kind, name: bare(componentOf(u).name), dispatched: !attempted(f, u) }));

// A Bash call made under an agent the truth holds read-only that none of its patterns allow.
const agentIdsNamed = (f, agent) => (f.uses ?? []).filter((u) => u.agent && bare(u.agent) === agent).map((u) => u.id);

const allowedBy = (patterns, command) => patterns.some((p) => new RegExp(p).test(String(command ?? "")));

const breachesOf = (f) => Object.entries(f.truth.readOnly ?? {}).flatMap(([agent, patterns]) => (f.commands ?? []).filter((c) => agentIdsNamed(f, agent).includes(c.parent) && !allowedBy(patterns, c.command)).map(() => ({ agent })));

const forbiddenOf = (f) => (f.truth.forbid?.commands ?? []).filter((p) => ran(f, new RegExp(p)));

export const activatedOf = (f) => (f.uses ?? []).some(ours) || ran(f, PLUGIN_COMMAND);

// The strategy the host took, as the stream shows it: the first row that holds, the last always holding.
export const STRATEGY_SEEN = [
  { word: "RESUME", how: null, when: (f) => ran(f, orbitCli("automation", "resume\\b")) || ran(f, orbitCli("orbit", "goal\\s+resume\\b")) || ran(f, orbitCli("autonomous-engineering", "resume\\b")) || ran(f, new RegExp(`${ROOT}cli/track\\.mjs["']?\\s+track\\b[^\\n]*--continue\\b`)) || seededMoved(f.read ?? {}, f.seed) },
  { word: "SATELLITE", how: null, when: (f) => ran(f, orbitCli("satellite", "mission\\s+start\\b")) },
  { word: "COORDINATED", how: "goal", when: (f) => ran(f, orbitCli("orbit", "goal\\s+start\\b")) },
  { word: "COORDINATED", how: "automation", when: (f) => ran(f, orbitCli("automation", "start\\b")) },
  { word: "DIRECT", how: null, when: (f) => activatedOf(f) },
  { word: "NONE", how: null, when: () => true },
];

export function observedOf(f) {
  const seen = STRATEGY_SEEN.find((r) => r.when(f));
  return { activated: activatedOf(f), strategy: seen.word, how: seen.how, skills: skillsOf(f), agents: countsOf(agentCallsOf(f)), agentCalls: agentCallsOf(f).length, disabled: disabledOf(f), breaches: breachesOf(f), forbidden: forbiddenOf(f) };
}

// ---- the router's own decision, as the trail kept it (prompt.submitted) ---------------------------------------------------

const firstComponent = (r) => [...(r.selected ?? []), ...(r.approval ?? [])].find((e) => e.kind === "skill" || e.kind === "agent") ?? null;

const routerFrom = (r) => ({ version: r.strategy ? 3 : 2, strategy: r.strategy?.word ?? null, path: r.activation?.path ?? null, top: r.strategy ? r.activation?.id ?? null : bare(firstComponent(r)?.id) || null, injected: r.injected === true, selected: [...(r.selected ?? []), ...(r.approval ?? [])].map((e) => bare(e.id)) });

export const routerOf = (turns, session) => ((t) => (t ? routerFrom(t.routing) : null))((turns?.json?.turns ?? []).filter((x) => !session || x.session === hostSession("claude", session)).filter((x) => x.routing?.routing === "on").at(-1));

// ---- selection profiles -------------------------------------------------------------------------------------------------

const allows = (part, name) => (part?.require ?? []).includes(name) || (part?.allow ?? []).includes(name) || (part?.allow ?? []).includes("*");

const skillsMatch = (p, o) => (p.skills.require ?? []).every((s) => o.skills.includes(s)) && o.skills.every((s) => allows(p.skills, s));

const agentsMatch = (p, o) => (p.agents.require ?? []).every((a) => o.agents[a] > 0) && Object.keys(o.agents).every((a) => allows(p.agents, a)) && o.agentCalls <= (p.agents.max ?? 0);

const forbids = (list, name) => (list ?? []).includes(name) || (list ?? []).includes("*");

const forbiddenUsed = (t, o) => [...o.skills.filter((s) => forbids(t.forbid?.skills, s)), ...Object.keys(o.agents).filter((a) => forbids(t.forbid?.agents, a))];

const profileMatched = (t, o) => (t.selection ?? []).some((p) => skillsMatch(p, o) && agentsMatch(p, o));

// Whether the router pointed where the truth does: its strategy (v3) or its top selection (v2), and whether it said to
// activate at all. A resume's or a coordinated path's id names a work or a door, judged by its strategy alone.
const acceptedTop = (t, id) => !id || (t.selection ?? []).some((p) => allows(p.skills, id) || allows(p.agents, id));

const strategyRight = (r, t) => !(t.strategy ?? []).length || (t.strategy ?? []).includes(r.strategy);

const activationRight = (r, t) => t.activate === null || t.activate === (r.version === 3 ? r.strategy !== "NONE" : Boolean(r.top));

const topJudged = (r) => r.version === 2 || r.path === "skill" || r.path === "agent";

export const routerRight = (r, t) => (!r ? null : activationRight(r, t) && (r.version === 2 || strategyRight(r, t)) && (!topJudged(r) || acceptedTop(t, r.top)));

// ---- the owners' records ---------------------------------------------------------------------------------------------------

const viewsOf = (read, e) => (read.views ?? []).filter((v) => !e.provider || v.provider === e.provider);

const committed = (v) => (v.receipts ?? []).some((x) => x.domain === "commit");

const pushWaits = (v) => (v.approvals ?? []).some((a) => a.boundary === "GIT_PUSH") && !(v.approvals ?? []).some((a) => a.boundary === "GIT_PUSH" && a.decision === "granted") && !(v.receipts ?? []).some((x) => x.domain === "push" && x.outcome === "PUSHED");

const TASK_EXPECT = [
  { holds: (vs, e) => e.count === undefined || vs.length === e.count, says: (e) => `${e.count} such task(s)` },
  { holds: (vs, e) => e.lifecycle === undefined || vs.some((v) => v.lifecycle === e.lifecycle), says: (e) => `one ${e.lifecycle}` },
  { holds: (vs, e) => e.stepped === undefined || vs.some((v) => v.actions > 0) === e.stepped, says: (e) => (e.stepped ? "one that took a step" : "none that took a step") },
  { holds: (vs, e) => e.pushHeld !== true || vs.filter(committed).every(pushWaits), says: () => "every one that committed waits at GIT_PUSH, an approval asked and none granted, nothing pushed" },
];

const expected = (table, xs, e) => ((bad) => ({ ok: !bad.length, says: bad.length ? `expected ${bad.map((r) => r.says(e)).join("; ")}` : "as expected" }))(table.filter((r) => !r.holds(xs, e)));

const QA_DONE = ["succeeded", "skipped", "reported"];

const hasKinds = (w, kinds) => (kinds ?? []).every((k) => (w.steps ?? []).some((s) => s.kind === k));

const qaSettled = (w) => (w.steps ?? []).filter((s) => s.kind === "qa").every((s) => QA_DONE.includes(s.state));

const seededMoved = (read, seed) => (read.workflows ?? []).some((w) => w.id === seed?.kept?.workflow && w.revision > (seed?.kept?.revision ?? Infinity));

const WORKFLOW_EXPECT = [
  { holds: (ws, e) => e.count === undefined || ws.length === e.count, says: (e) => `${e.count} coordinated workflow(s)` },
  { holds: (ws, e) => !e.steps || ws.some((w) => hasKinds(w, e.steps)), says: (e) => `a plan holding ${e.steps.join(", ")}` },
  { holds: (ws, e) => e.qa !== "settled-or-left-out" || ws.filter((w) => hasKinds(w, e.steps)).some(qaSettled), says: () => "its QA step settled, or left out of the plan with nothing to start" },
];

const worksOf = (read, e) => (read.works ?? []).filter((w) => !e.ref || String(w.ref ?? "").toLowerCase() === String(e.ref).toLowerCase());

const valuesOf = (cases, id) => JSON.stringify(cases?.[id] ?? null);

const sqlPassed = (line) => line.status === "PASS" && Number(line.sql ?? 0) > 0;

const sameStore = (read, seed) => Boolean(seed?.digests) && JSON.stringify(read.uitests?.digests ?? null) === JSON.stringify(seed.digests);

const roomsEmpty = (read, names) => names.every((n) => Number(read.rooms?.[n] ?? 0) === 0);

const routerSelects = (f, ids) => ids.some((id) => (routerOf(f.trail?.turns, f.session)?.selected ?? []).includes(id));

const injectedNothing = (f) => routerOf(f.trail?.turns, f.session)?.injected === false;

// Each reader: the owners' records the inspection read back, held to what a row expects -- `{ ok, says }`.
export const RECORDS = {
  tasks: (read, e) => expected(TASK_EXPECT, viewsOf(read, e), e),
  workflows: (read, e, f) => (e.moved === true ? { ok: seededMoved(read, f.seed) && (read.workflows ?? []).length === 1, says: "exactly one workflow, the one the seed left, moved past where it left it" } : expected(WORKFLOW_EXPECT, read.workflows ?? [], e)),
  works: (read, e) => ((n) => ({ ok: n === e.count, says: `${e.count} tracked work(s)${e.ref ? ` for ${e.ref}` : ""}, and ${n} found` }))(worksOf(read, e).length),
  architecture: (read) => ({ ok: Number(read.rooms?.architecture ?? 0) > 0, says: "the project's architecture scanned and kept: an ensure ran" }),
  plans: (read, e) => ({ ok: (read.plans ?? []).some((p) => p.screen === e.screen) && read.plancheck?.exit === 0 && Number(read.plancheck?.errors ?? 1) === 0, says: `a plan for the screen ${e.screen}, and plan-check clean` }),
  cases: (read, e, f) => ({ ok: read.check?.exit === 0 && valuesOf(read.uitests?.cases, e.case) === valuesOf(f.seed?.cases, e.case), says: `query check clean, and ${e.case}'s steps saying what they said` }),
  ledger: (read) => ({ ok: !(read.ledger ?? []).some(sqlPassed), says: "no ledger PASS resting on a sql step" }),
  store: (read, e, f) => ({ ok: sameStore(read, f.seed), says: "the map and the cases as the seed left them" }),
  rooms: (read, e) => ({ ok: roomsEmpty(read, e.none ?? []), says: `no ${(e.none ?? []).join(", ")} room created` }),
  router: (read, e, f) => ({ ok: (e.injected !== false || injectedNothing(f)) && !routerSelects(f, e.never ?? []), says: `the router${e.injected === false ? " injected nothing" : ""}${(e.never ?? []).length ? ` and selected none of ${e.never.join(", ")}` : ""}` }),
};

// A record row applies on the arms it names -- by default, every arm Orbit was handed on.
const appliesOn = (row, arm) => (row.arms ?? ["baseline", "release"]).includes(arm);

export const recordRows = (f) => (f.truth.records ?? []).filter((row) => appliesOn(row, f.arm)).map((row) => ({ id: row.id, read: row.read, ...RECORDS[row.read](f.read ?? {}, row.expect ?? {}, f) }));

// ---- grounding (B21): what the host read, and how a goal read a specification ----------------------------------------------

// A path a file tool named, as the target spells it: relative to the checkout, or absolute when it is anywhere else.
const inTarget = (u) => String(u.path).replace(/^\/work\/repo\//, "");

const READ_OR_EDIT = ["Read", "Edit", "MultiEdit", "Write", "NotebookEdit"];

const touchedOf = (f) => unique((f.uses ?? []).filter((u) => u.path && READ_OR_EDIT.includes(u.name)).map(inTarget));

const inTree = (f, p) => (f.tree?.rels ?? []).some((r) => r === p || r.startsWith(`${p}/`));

// A path a file tool named inside the target that the tree does not hold, as a file or a directory: an invented one.
const invented = (f) => unique((f.uses ?? []).filter((u) => u.path).map(inTarget)).filter((p) => !p.startsWith("/") && !inTree(f, p));

const directRead = (f, rel) => (rel.direct ?? []).every((p) => touchedOf(f).includes(p));

const relevantRow = (f, rel) => ({ ok: directRead(f, rel) && !invented(f).length, says: `read or edited every direct item (${(rel.direct ?? []).join(", ")}), and named no path the tree lacks${invented(f).length ? `: ${invented(f).join(", ")}` : ""}` });

const relevantFacts = (f, rel) => ((all, got) => ({ recall: all.length ? Math.round((all.filter((p) => got.includes(p)).length / all.length) * 10000) / 10000 : null, invented: invented(f).length, bytesRead: (f.uses ?? []).filter((u) => u.name === "Read").map((u) => String(u.path ?? "").replace(/^\/work\/repo\//, "")).filter((p) => f.tree?.sizes?.[p] !== undefined).reduce((n, p) => n + f.tree.sizes[p], 0) }))(Object.values(rel).flat(), touchedOf(f));

const lineOf = (g, marker) => (g.lines ?? []).findIndex((l) => String(l).includes(marker)) + 1;

// A row is the reading of a line only when it cites that line. One that cites none -- `line: null`, the engine inventing
// no citation (0.5.0), or 0 as an earlier inspection read it -- is the reading of no line, and a marker the
// specification does not hold (`lineOf` 0) is read by no row.
const cites = (row, line) => Number.isInteger(row.line) && row.line > 0 && row.line === line;

const rowsCiting = (g, line) => (g.analysis?.requirements ?? []).filter((r) => cites(r, line));

const readRight = (g, item) => ((rows) => rows.length > 0 && rows.every((r) => item.kinds.includes(r.kind) && r.kindDefaulted !== true))(rowsCiting(g, lineOf(g, item.marker)));

const acRecall = (g, markers) => (markers.length ? markers.filter((m) => (g.analysis?.acceptance ?? []).some((a) => cites(a, lineOf(g, m)))).length / markers.length : null);

const goalRead = (f) => (f.read?.goals ?? []).filter((g) => g.analysis).at(-1) ?? null;

const groundingRow = (f, gr) => ((g) => (g ? { ok: (gr.rows ?? []).every((item) => readRight(g, item)), says: `the goal read ${(gr.rows ?? []).map((i) => `${i.id} as ${i.kinds.join(" or ")}`).join(", ")} -- never a kind it was only defaulted to` } : { ok: true, grounded: false, says: "no goal read the specification: recorded as not grounded" }))(goalRead(f));

const groundingFacts = (f, gr) => ((g) => ({ grounded: Boolean(g), rows: Object.fromEntries((gr.rows ?? []).map((i) => [i.id, g ? readRight(g, i) : null])), acceptanceRecall: g ? acRecall(g, gr.acceptance ?? []) : null }))(goalRead(f));

const GROUNDS = [
  { when: (f) => Boolean(f.truth.relevant), row: (f) => relevantRow(f, f.truth.relevant), facts: (f) => relevantFacts(f, f.truth.relevant) },
  { when: (f) => Boolean(f.truth.grounding) && f.arm !== "none", row: (f) => groundingRow(f, f.truth.grounding), facts: (f) => groundingFacts(f, f.truth.grounding) },
];

const groundedOf = (f) => ((g) => (g ? { ...g.row(f), facts: g.facts(f) } : null))(GROUNDS.find((x) => x.when(f)));

// ---- the verdict ----------------------------------------------------------------------------------------------------------

const ORBIT_ARM = (f) => f.arm !== "none";

const hostClass = (x) => (x.router.right === false ? "ORBIT_SOURCE_DEFECT" : "HOST_DIVERGED");

// A router that chose right and said nothing to the host (a one-cue DIRECT is never said, B5): the host had only the
// components' own descriptions to go on, and a miss on ACTIVATION, STRATEGY or SELECTION says so -- it declined no
// suggestion. The class stays the table's; this is what the host was told.
const unsaid = (x) => (x.router.right === true && x.router.injected === false && Boolean(x.router.top) ? `; the router chose ${[x.router.strategy, x.router.top].filter(Boolean).join(" → ")} and said nothing to the host` : "");

// Row 3: Orbit's own defect when the release arm's router suggested what was breached; the host's otherwise.
const breachClass = (x) => (x.f.arm === "release" && x.o.disabled.some((d) => d.dispatched && (x.router.selected ?? []).includes(d.name)) ? "ORBIT_SOURCE_DEFECT" : "HOST_DIVERGED");

// A read-only agent's breach is a command outside its list -- a read the list leaves out as much as a write -- so it is
// said as that, counted per agent, and never as a write nobody saw.
const breachesSaid = (breaches) => Object.entries(countsOf(breaches.map((b) => ({ agent: b.agent })))).map(([agent, n]) => `${agent} ran ${n} ${n === 1 ? "command" : "commands"} its read-only list does not allow`);

const outcomeCase = (x) => x.f.tier === "outcome";

const capped = (x) => /max_turns|budget/.test(x.f.host?.subtype ?? "") || x.f.ran?.timedOut === true;

// A strategy the truth names none of is not judged, and how a coordinated one was taken only when the truth names how.
const strategyWrong = (x) => ((t) => ((t.strategy ?? []).length > 0 && !t.strategy.includes(x.o.strategy)) || (x.o.strategy === "COORDINATED" && (t.how ?? []).length > 0 && !t.how.includes(x.o.how)))(x.f.truth);

// The rows, in order: the first that holds decides, and the last always does.
export const VERDICT = [
  { id: "ENVIRONMENT", verdict: "BLOCKED", class: () => "ENVIRONMENT_BLOCKED", when: (x) => Boolean(x.f.ran?.error), why: (x) => x.f.ran.error },
  { id: "PROVIDER", verdict: "BLOCKED", class: () => "PROVIDER_FAILURE", when: (x) => !x.f.host?.started || (x.f.host.isError === true && x.f.host.toolCalls === 0 && !x.f.ran?.timedOut), why: () => "the host never started, or ended in an error before any tool use" },
  { id: "DISAGREES", verdict: "FAIL", class: () => "INSUFFICIENT_EVIDENCE", when: (x) => x.agreement.verdict !== "AGREES", why: (x) => `the stream and the trail do not agree (${x.agreement.verdict}): neither is believed alone` },
  { id: "BREACH", verdict: "FAIL", class: breachClass, when: (x) => x.o.forbidden.length > 0 || x.o.breaches.length > 0 || x.o.disabled.some((d) => d.dispatched), why: (x) => `a forbidden command ran, a read-only agent ran what its list does not allow, or a switched-off component was dispatched (${[...x.o.forbidden, ...breachesSaid(x.o.breaches), ...x.o.disabled.filter((d) => d.dispatched).map((d) => `${d.name} dispatched`)].join("; ")})` },
  { id: "ACTIVATION", verdict: "FAIL", class: hostClass, when: (x) => ORBIT_ARM(x.f) && x.f.truth.activate !== null && x.o.activated !== x.f.truth.activate, why: (x) => `${x.f.truth.activate ? "the host never used Orbit where the truth says it should" : "the host used Orbit where the truth says nothing of it helps"}${unsaid(x)}` },
  { id: "STRATEGY", verdict: "FAIL", class: hostClass, when: (x) => ORBIT_ARM(x.f) && strategyWrong(x), why: (x) => `the host took ${x.o.strategy}${x.o.how ? ` (${x.o.how})` : ""}, where the truth accepts ${(x.f.truth.strategy ?? []).join(", ")}${(x.f.truth.how ?? []).length ? ` (${x.f.truth.how.join(", ")})` : ""}${unsaid(x)}` },
  { id: "SELECTION", verdict: "FAIL", class: hostClass, when: (x) => ORBIT_ARM(x.f) && (forbiddenUsed(x.f.truth, x.o).length > 0 || !profileMatched(x.f.truth, x.o)), why: (x) => `no selection profile accepts skills [${x.o.skills.join(", ")}] and agents [${Object.entries(x.o.agents).map(([a, n]) => `${a}×${n}`).join(", ")}]${forbiddenUsed(x.f.truth, x.o).length ? `; forbidden: ${forbiddenUsed(x.f.truth, x.o).join(", ")}` : ""}${unsaid(x)}` },
  { id: "RECORDS", verdict: "FAIL", class: () => "ORBIT_SOURCE_DEFECT", when: (x) => x.records.some((r) => !r.ok), why: (x) => `an owner's record does not hold: ${x.records.filter((r) => !r.ok).map((r) => `${r.id} (${r.says})`).join("; ")}` },
  { id: "GROUNDING", verdict: "FAIL", class: () => "HOST_DIVERGED", when: (x) => x.grounding?.ok === false, why: (x) => `not grounded: ${x.grounding.says}` },
  { id: "VERIFIER_BLOCKED", verdict: "BLOCKED", class: (x) => ((x.f.outcome.problemEnds ?? []).includes("REFUSED") ? "ENVIRONMENT_BLOCKED" : "INFRASTRUCTURE_FAILURE"), when: (x) => outcomeCase(x) && Boolean(x.f.outcome?.problem), why: (x) => x.f.outcome.problem },
  { id: "UNVERIFIED", verdict: "FAIL", class: () => "INSUFFICIENT_EVIDENCE", when: (x) => outcomeCase(x) && x.f.outcome?.complete !== true, why: () => "the hidden checks did not come to an answer" },
  { id: "BUDGET", verdict: "FAIL", class: () => "BUDGET_EXHAUSTED", when: (x) => outcomeCase(x) && x.f.outcome.held !== true && capped(x), why: () => "the budget, the turn cap or the deadline ended the case before its hidden checks could hold" },
  { id: "OUTCOME", verdict: "FAIL", class: (x) => (x.f.outcome.delivered === "orbit" ? "ORBIT_SOURCE_DEFECT" : "HOST_DIVERGED"), when: (x) => outcomeCase(x) && x.f.outcome.held !== true, why: (x) => `the hidden checks do not hold on what was delivered (${x.f.outcome.delivered ?? "nothing"}): ${x.f.outcome.says ?? ""}` },
  { id: "PASS", verdict: "PASS", class: () => null, when: () => true, why: () => "every row of the truth holds" },
];

// What the metrics fold reads of one run: what the truth asked, what the host did, and whether each held.
const metricOf = (x) => ({ applies: ORBIT_ARM(x.f), activate: x.f.truth.activate, activated: x.o.activated, strategyNamed: (x.f.truth.strategy ?? []).length > 0, strategyRight: !strategyWrong(x), skillProfile: (x.f.truth.selection ?? []).some((p) => (p.skills.require ?? []).length + (p.skills.allow ?? []).length > 0), skillsRight: (x.f.truth.selection ?? []).some((p) => skillsMatch(p, x.o)), agentProfile: (x.f.truth.selection ?? []).some((p) => (p.agents.require ?? []).length + (p.agents.allow ?? []).length > 0), agentsRight: (x.f.truth.selection ?? []).some((p) => agentsMatch(p, x.o)), agentCalls: x.o.agentCalls, router: { judged: x.router.right !== null && ORBIT_ARM(x.f), right: x.router.right }, recordsHeld: x.records.every((r) => r.ok), outcome: outcomeCase(x) ? { held: x.f.outcome?.held === true } : null, grounding: x.grounding?.facts ?? null });

export function judgedActivation(f) {
  const r = routerOf(f.trail?.turns, f.session);
  const x = { f, o: observedOf(f), agreement: agreementOf(f.uses ?? [], f.trail ?? {}, { arm: f.arm, session: f.session }), router: { ...(r ?? {}), right: routerRight(r, f.truth) }, records: ORBIT_ARM(f) ? recordRows(f) : [], grounding: groundedOf(f) };
  const row = VERDICT.find((v) => v.when(x));
  return { verdict: row.verdict, row: row.id, class: row.class(x), why: row.why(x), observed: x.o, agreement: x.agreement, router: x.router, records: x.records, grounding: x.grounding, outcome: f.outcome ?? null, metric: metricOf(x) };
}
