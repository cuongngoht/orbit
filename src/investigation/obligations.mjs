// What an investigation still OWES, derived from its journal on every read and
// stored nowhere. The loop's frontier is the pending part of this list, and a
// decision may only target something on it.
//
// An obligation is one behaviour, on one layer, in one context, that has to
// reach a disposition (src/investigation/vocab.mjs OBLIGATION_STATES). Each KIND
// below says where they come from and what settles one:
//
//   post-write      an action wrote (the map says so, or its recorded call
//                   answered 2xx): what it wrote has to be read back below the
//                   screen -- the one obligation a write creates at once
//   finding-need    a suspicion the evidence has not settled yet
//   scenario-layer  a QA plan's scenario, per layer it committed to -- the PBI
//                   way in, and the hybrid one
//   tenancy-row     a row of the tenant matrix a person declared
//   question        a requirement question put to a person
//   control-effect  a control in scope the map records -- the screen way in
//   surface-visit   a screen in scope nobody has looked at yet
//   test-obligation a GENERATED test's obligation (0.1.0): derived from an accepted plan
//                   against the frozen graph, owed until what its latest execution came
//                   to settles it -- a design and a version are steps toward it, never its end
//
// The rank is the default order of the frontier: what a write owes comes
// first, then suspicions, then requirements, then exploration. In hybrid mode a
// control a plan scenario already drives (`mutation.effect`) is that scenario's
// to settle, so it is not owed twice.
//
// Three attempts that produced nothing new stop an obligation being pending:
// it goes to a person with the reason, rather than looping. An open question
// on an obligation parks it until a person answers.
import { short } from "../hash.mjs";
import { writes } from "../network/observe.mjs";
import { commitments, gaps } from "../qa/commit.mjs";
import { READINESS } from "../qa/vocab.mjs";
import { destructiveReasons } from "../run/gates/destructive.mjs";
import { recordedCallIn } from "./findings.mjs";
import { chainOf } from "./model.mjs";
import { controlOf, tablesOf } from "./surfaces.mjs";
import { latestFor } from "./receipts.mjs";
import { matrixOf } from "./tenancy.mjs";
import { attemptsOutcome, verificationOutcomeOf } from "./verification.mjs";

export const ATTEMPTS = 3;

const pending = (why) => ({ status: "pending", why, evidence: [] });
const satisfied = (why, evidence = []) => ({ status: "satisfied", why, evidence });
const violated = (why, evidence = []) => ({ status: "violated", why, evidence });
const blocked = (blocker, why, evidence = []) => ({ status: "blocked", blocker, why, evidence });
const person = (why) => ({ status: "needs-requirement", blocker: "person", why, evidence: [] });

// lw: { model, ctx: { graph }, settings, mode, inputMode, plans, digestOf,
//       dataLayer (anything can read below the screen here), capabilities }
export function obligationsOf(lw) {
  const raw = KINDS.flatMap((k) => k.derive(lw).map((o) => ({ ...o, kind: k.kind, rank: k.rank, id: idOf(k.kind, o) })));
  return owedOnce(lw, raw).map((o) => parked(lw, { ...o, ...KINDS.find((k) => k.kind === o.kind).state(o, lw) }));
}

export const frontierOf = (obligations) => obligations.filter((o) => o.status === "pending").sort(byRank);

const byRank = (a, b) => a.rank - b.rank || (a.order ?? 9) - (b.order ?? 9) || a.id.localeCompare(b.id);

const idOf = (kind, o) => `obl-${short(`${kind}|${o.subject}|${o.layer}`, 10)}`;

// A control a plan scenario drives is that scenario's to settle.
function owedOnce(lw, raw) {
  const driven = new Set(lw.plans.flatMap((p) => (p.scenarios ?? []).map((s) => s?.mutation?.effect).filter(Boolean)));
  return raw.filter((o) => !(o.kind === "control-effect" && driven.has(o.subject)));
}

// What happens to an obligation once its own evidence has spoken, first row
// that applies: a satisfied one whose receipt's files moved since is owed
// AGAIN (rank 4.5, after requirements and tenancy); a pending one waits for an
// open question's answer, or goes to a person after attempts that moved nothing.
const REVIEW = [
  { when: (lw, o) => o.status === "satisfied" && staleReceipt(lw, o), as: (lw, o) => ({ ...o, ...pending(`what satisfied it has moved since its receipt (${staleReceipt(lw, o).scope.join(", ")}) — check it again`), rank: 4.5, stale: true }) },
  { when: (lw, o) => o.status === "pending" && Boolean(openAsk(lw, o)), as: (lw, o) => ({ ...o, ...person(`waiting on a person's answer to ${openAsk(lw, o).id}: ${openAsk(lw, o).asks}`) }) },
  { when: (lw, o) => o.status === "pending" && idleAttempts(lw.model, o.id) >= ATTEMPTS, as: (lw, o) => ({ ...o, ...blocked("person", `${ATTEMPTS} attempts produced nothing new — what would settle it is a person's call: ${o.why}`) }) },
];

function parked(lw, o) {
  const row = REVIEW.find((r) => r.when(lw, o));
  return row ? row.as(lw, o) : o;
}

const openAsk = (lw, o) => lw.model.questions.find((q) => q.obligation === o.id && !lw.model.answers.some((a) => a.question === q.id)) ?? null;

// The obligation's latest receipt, when its scope has moved since (receipts.mjs).
function staleReceipt(lw, o) {
  const r = latestFor(lw.model, o.id);
  return r && lw.applicable?.(r) === "stale" ? r : null;
}

const idleAttempts = (model, id) => model.decisions.filter((d) => d.target === id && model.settled.some((s) => s.decision === d.id && s.progress === false)).length;

// ---------------------------------------------------------------- post-write
const controlFor = (lw, a) => (lw.ctx.graph.edgeOn.get(a.on) ? controlOf(lw.ctx.graph, lw.ctx.graph.edgeOn.get(a.on)) : null);

const wroteOk = (r) => Boolean(r) && writes(r.method) && r.status >= 200 && r.status < 300;

const wrote = (lw, a) => Boolean(controlFor(lw, a)?.writes) || wroteOk(recordedCallIn(lw.model, lw, a));

function postWrites(lw) {
  return lw.model.actions.filter((a) => a.state === "done" && a.on && wrote(lw, a)).map((a) => postWrite(lw, a));
}

function postWrite(lw, a) {
  const tables = controlFor(lw, a) ? tablesOf(controlFor(lw, a)) : [];
  return { subject: a.id, layer: "data", title: `read back what ${a.id} (${a.on}) wrote`, sources: [{ from: "action", ref: a.id }], oracle: { kind: "map", ref: a.on, authority: "accepted" }, can: ["check-data", "reproduce", "ask"], template: { kind: "check-data", action: a.id, tables, typed: typedChoices(lw.model, a), expect: 1 } };
}

// What a query may name as the value this chain typed: ${TC} when it typed one
// value, ${TC:<control>} for each when it typed several (src/investigation/data.mjs).
function typedChoices(model, a) {
  const typed = chainOf(model, a.id).flatMap((x) => Object.entries(x.synthetic ?? {}));
  return new Set(typed.map(([, v]) => v)).size > 1 ? typed.map(([on]) => `\${TC:${on}}`) : ["${TC}"];
}

function postWriteState(o, lw) {
  const occurred = readBackOf(lw.model, o.subject);
  if (occurred) return fromOutcome(occurred);
  if (!lw.dataLayer) return blocked("capability", "nothing can read below the screen on this machine: no sql.command, and no registered read-only capability");
  return o.template.tables.length || lw.capabilities.length ? pending("nothing has read it back yet") : blocked("capability", "the map records no table this control writes — record the effect (orbit-ui-map), or read it through a capability");
}

function occurrenceFor(model, family, actionId) {
  const found = model.findings.filter((f) => f.family === family);
  return found.flatMap((f) => (f.occurrences ?? [f]).map((x) => ({ ...x, key: f.key }))).find((x) => x.action === actionId) ?? null;
}

// Where a read-back's answer lands, first that holds: the persistence finding,
// or -- when a second write explains the extra record -- the duplicate finding
// that cites the check (src/investigation/findings.mjs hands it over). Either
// way the check settled what the write owed; asked again, it would say the same.
const READ_BACK = [
  (model, actionId) => occurrenceFor(model, "persistence", actionId),
  (model, actionId) => citing(occurrenceFor(model, "duplicate", actionId), checkIdsOf(model, actionId)),
];

const readBackOf = (model, actionId) => READ_BACK.map((find) => find(model, actionId)).find(Boolean) ?? null;

const checkIdsOf = (model, actionId) => new Set(model.checks.filter((c) => c.action === actionId && c.layer === "data").map((c) => c.id));

const citing = (x, ids) => (x && x.evidence.some((e) => ids.has(e)) ? x : null);

// What a finding's outcome makes of the obligation it is about.
const FROM_OUTCOME = {
  OBSERVED_EXPECTED_BEHAVIOR: (x) => satisfied(`it held: ${x.actual}`, x.evidence),
  CONFIRMED_DEFECT: (x) => violated(`a confirmed defect: ${x.actual}`, x.evidence),
  REQUIRES_REQUIREMENT: (x) => ({ ...person(`what should happen is not written down: ${x.actual}`), evidence: x.evidence }),
  BLOCKED: (x) => blocked("environment", `the check could not run here: ${x.actual}`, x.evidence),
  SUSPECTED_DEFECT: (x) => ({ ...pending(`suspected, not settled: ${x.actual}`), evidence: x.evidence }),
  INCONCLUSIVE: (x) => blocked("capability", `the evidence cannot decide it: ${x.actual}`, x.evidence),
};

const fromOutcome = (x) => (FROM_OUTCOME[x.outcome] ?? FROM_OUTCOME.INCONCLUSIVE)(x);

// -------------------------------------------------------------- finding-need
// Persistence is settled by its post-write obligation, so it is not owed twice.
// A run's failure has nothing the loop may do about it: its verdict is the
// runner's, triage and orbit-failure-analyst own what happens next, and a draft
// case speaks only once a person accepts it -- running it again until it passes
// is exactly what self-healing must never be. So it is a person's, at once.
const SETTLES = { duplicate: ["check-data", "reproduce", "ask"], console: ["reproduce", "ask"], "failed-call": ["reproduce", "ask"], run: [], security: ["security", "ask"] };
const UNSETTLED = new Set(["SUSPECTED_DEFECT", "INCONCLUSIVE"]);

function findingNeeds(lw) {
  return lw.model.findings.filter((f) => UNSETTLED.has(f.outcome) && SETTLES[f.family]).map((f) => ({ subject: f.key, layer: f.family, title: `settle: ${f.say}`, sources: [{ from: "finding", ref: f.key }], oracle: { kind: f.oracle ?? "none", ref: null, authority: null }, can: SETTLES[f.family], template: f.action ? { kind: "reproduce", finding: f.id } : null, needs: f.needs ?? [] }));
}

const findingNeedState = (o) => (o.can.length ? pending(o.needs.join("; ") || "the evidence does not decide it yet") : blocked("person", `nothing this loop can run settles it — ${o.needs.join("; ") || "a person reads the evidence"}`));

// ------------------------------------------------------------ scenario-layer
const PRIORITY = { P1: 1, P2: 2, P3: 3 };

function scenarioLayers(lw) {
  return lw.plans.flatMap((p) => (p.scenarios ?? []).filter((s) => s && s.readiness !== "deferred").flatMap((s) => [...commitments(s).map((c) => scenarioOb(p, s, c.layer, c.says, null)), ...gaps(s).map((g) => scenarioOb(p, s, g.layer, g.because, g.because))]));
}

function scenarioOb(p, s, layer, says, gap) {
  return { subject: `${p.id}#${s.id}`, layer, gap, plan: p.id, scenario: s.id, execution: s.execution ?? "auto", ready: READINESS.find((r) => r.name === s.readiness)?.ready ?? true, blockers: (s.blockers ?? []).map((b) => b?.says).filter(Boolean), cases: (s.cases ?? []).map((l) => l?.id).filter(Boolean), covers: s.covers ?? [], title: `${s.id} ${layer}: ${says || s.name || ""}`, order: PRIORITY[s.priority] ?? 9, sources: [{ from: "plan", ref: `${p.id}#${s.id}` }, ...(s.mutation?.effect ? [{ from: "map", ref: s.mutation.effect }] : [])], oracle: { kind: "requirement", ref: `${p.id}#${(s.covers ?? []).join(",")}`, authority: authorityOf(p, s) }, can: ["run-case", "act", "check-data", "ask"], template: { kind: "run-case", case: s.cases?.[0]?.id ?? null, draft: Boolean(p._draft) } };
}

// A criterion is the team's word only when every source it cites is ACCEPTED
// and the plan itself is not an agent's draft (src/investigation/input.mjs).
function authorityOf(p, s) {
  const cited = new Set((p.criteria ?? []).filter((c) => (s.covers ?? []).includes(c.id)).map((c) => c.source));
  const words = (p.sources ?? []).filter((x) => cited.has(x.id)).map((x) => x.authority ?? (p._draft ? "draft" : "accepted"));
  return !p._draft && words.length > 0 && words.every((x) => x === "accepted") ? "accepted" : "draft";
}

// What the plan itself says about a scenario comes first: a layer it cannot
// check, a check only a person performs, a scenario that is not ready. Then the
// evidence. A destructive case is a person's to run on purpose -- the loop never
// runs one (src/investigation/dispatch.mjs refuses it), so until somebody has,
// the scenario waits on them rather than on this machine.
const SCENARIO = [
  { when: (o) => Boolean(o.gap), as: (o) => blocked("capability", `unverifiable here: ${o.gap}`) },
  { when: (o) => o.execution === "manual", as: (o) => blocked("person", `${o.scenario} is a manual check — a person performs it, and the plan's checks record it`) },
  { when: (o) => !o.ready, as: (o) => blocked("person", `${o.scenario} is not ready: ${o.blockers.join("; ") || "the plan says it is still being designed"}`) },
  { when: (o, lw) => Boolean(openPlanQuestion(lw, o)), as: (o, lw) => person(`open question ${openPlanQuestion(lw, o).id}: ${openPlanQuestion(lw, o).asks}`) },
  { when: (o, lw) => Boolean(runOf(lw, o, failed)), as: (o, lw) => blocked("person", `${runOf(lw, o, failed).case} did not pass (${runOf(lw, o, failed).status})${passedToo(lw, o)} — a run's failure is a suspicion here, and triage and orbit-failure-analyst own it`, runsFor(lw, o).filter((r) => current(lw, r)).map((r) => r.id)) },
  { when: (o, lw) => Boolean(runOf(lw, o, proves)), as: (o, lw) => satisfied(`${runOf(lw, o, proves).case} passed here and proved ${o.layer}`, [runOf(lw, o, proves).id]) },
  { when: (o, lw) => Boolean(runOf(lw, o, stopped)), as: (o, lw) => blocked("environment", `${runOf(lw, o, stopped).case} could not run here (${runOf(lw, o, stopped).status})`, [runOf(lw, o, stopped).id]) },
  { when: (o, lw) => isDestructiveCase(lw, o.cases[0], o.template.draft), as: (o) => blocked("person", `${o.cases[0]} is destructive — the loop never runs one; a person reads it with --dry and runs it on purpose`) },
  { when: () => true, as: (o) => pending(o.cases.length ? `no run here has proved ${o.layer} yet` : "no case drives it yet — write a draft case (cli/draft.mjs write) and run it") },
];

const scenarioState = (o, lw) => SCENARIO.find((r) => r.when(o, lw)).as(o, lw);

// A failure of the case as it stands outranks any pass of it -- a PASS beside a
// FAIL is not "satisfied" (the coverage lesson, A04, src/qa/coverage.mjs) -- and a
// run that could not happen here says nothing either way.
const proves = (lw, o, r) => r.status === "PASS" && (r.proved?.[o.layer] ?? 0) > 0 && current(lw, r);
const stopped = (lw, o, r) => ["BLOCKED", "REFUSED"].includes(r.status);
const failed = (lw, o, r) => ["FAIL", "INCONCLUSIVE"].includes(r.status) && current(lw, r);

function passedToo(lw, o) {
  const mine = runsFor(lw, o).filter((r) => current(lw, r) && !stopped(lw, o, r));
  const passes = mine.filter((r) => r.status === "PASS").length;
  return passes ? `, though ${passes} of ${mine.length} run(s) passed — intermittent` : "";
}

// The case's own flag, or a step on a control the map marks destructive -- the
// runner's own reading (src/run/gates/destructive.mjs), so the two cannot differ.
export function isDestructiveCase(lw, id, draft = false) {
  const c = id ? lw.findCase?.(id, draft) ?? null : null;
  return Boolean(c) && destructiveReasons(lw.ctx.graph, c, c.steps ?? []).length > 0;
}

// A PASS of the case as it stands: a digest that differs is a run of another case.
const current = (lw, r) => !r.case_digest || !lw.digestOf?.(r.case) || r.case_digest === lw.digestOf(r.case);

const runOf = (lw, o, test) => runsFor(lw, o).find((r) => test(lw, o, r)) ?? null;

// The runs of the cases the scenario links, and any run a decision on THIS
// obligation produced -- a draft case the agent wrote for it is linked that way.
function runsFor(lw, o) {
  const made = new Set(lw.model.decisions.filter((d) => d.target === o.id).flatMap((d) => lw.model.settled.filter((s) => s.decision === d.id).flatMap((s) => s.refs ?? [])));
  return lw.model.runs.filter((r) => o.cases.includes(r.case) || made.has(r.id)).reverse();
}

function openPlanQuestion(lw, o) {
  const p = lw.plans.find((x) => x.id === o.plan);
  return (p?.questions ?? []).find((q) => q.state !== "answered" && (q.blocks ?? []).some((b) => o.covers.includes(b))) ?? null;
}

// --------------------------------------------------------------- tenancy-row
function tenancyRows(lw) {
  if (lw.mode !== "security-test" || !lw.settings.tenancy) return [];
  return matrixOf(lw.settings.tenancy).map((r) => ({ subject: `row ${r.row}`, layer: "security", row: r.row, title: `${r.identity} ${r.operation} ${r.resource}: ${r.expect}`, sources: [{ from: "tenancy", ref: String(r.row) }], oracle: { kind: "contract", ref: `tenancy row ${r.row}`, authority: "accepted" }, can: ["security", "ask"], template: { kind: "security", rows: [r.row] } }));
}

const ROW = [
  { when: (xs) => !xs.length, as: () => pending("the matrix has not run this row") },
  { when: (xs) => xs.some((x) => x.outcome === "CONFIRMED_DEFECT"), as: (xs) => violated("the contract does not hold on a channel", xs.flatMap((x) => x.evidence)) },
  { when: (xs) => xs.some((x) => x.outcome === "BLOCKED"), as: (xs) => blocked("environment", "a channel could not be probed here", xs.flatMap((x) => x.evidence)) },
  { when: (xs) => xs.some((x) => x.outcome === "REQUIRES_REQUIREMENT"), as: () => person("the contract does not say what this row's answer should be") },
  { when: (xs) => xs.every((x) => x.outcome === "OBSERVED_EXPECTED_BEHAVIOR"), as: (xs) => satisfied("every channel did what the contract says", xs.flatMap((x) => x.evidence)) },
  { when: () => true, as: () => pending("a channel did not decide it — a positive control, or another attempt") },
];

function tenancyState(o, lw) {
  const records = new Set(lw.model.security.filter((r) => r.row === o.row).map((r) => r.id));
  const found = lw.model.findings.filter((f) => f.family === "security" && f.evidence.some((e) => records.has(e)));
  return ROW.find((r) => r.when(found)).as(found);
}

// ------------------------------------------------------------------ question
function openQuestions(lw) {
  return lw.model.questions.map((q) => ({ subject: q.id, layer: "requirement", question: q.id, title: `asked: ${q.asks}`, sources: [{ from: "question", ref: q.id }], oracle: { kind: "none", ref: null, authority: null }, can: [], template: null }));
}

function questionState(o, lw) {
  const answer = lw.model.answers.find((a) => a.question === o.question);
  return answer ? satisfied(`a person answered: ${answer.says}`, [answer.id]) : person("waiting on a person's answer (autonomous-qa answer --human)");
}

// ------------------------------------------------------------ control-effect
// A control the plan skipped says why in a code (src/investigation/plan.mjs);
// the ones a person can change are owed, the rest are listed as they are.
const SKIPPED = {
  destructive: (c) => ({ status: "not-applicable", why: c.why, evidence: [] }),
  "needs-write-mode": (c) => ({ status: "needs-approval", blocker: "person", why: c.why, evidence: [] }),
  "no-selector": (c) => blocked("capability", c.why),
  unreachable: (c) => blocked("capability", c.why),
};

function controlEffects(lw) {
  if (lw.inputMode === "pbi") return [];
  const plan = lw.model.plan?.actions ?? { planned: [], skipped: [] };
  return [...plan.planned.map((c) => controlOb(c, null)), ...plan.skipped.filter((c) => SKIPPED[c.code]).map((c) => controlOb(c, SKIPPED[c.code](c)))];
}

const controlOb = (c, fixed) => ({ subject: c.on, layer: "ui", fixed, title: `exercise ${c.on}`, sources: [{ from: "map", ref: c.on }], oracle: { kind: "map", ref: c.on, authority: "accepted" }, can: ["act", "ask"], template: { kind: "act", do: "click", on: c.on, reach: c.reach ?? null } });

function controlState(o, lw) {
  if (o.fixed) return o.fixed;
  const done = lw.model.actions.filter((a) => a.state === "done" && a.on === o.subject);
  return done.length ? satisfied(`exercised by ${done.map((a) => a.id).join(", ")}`, done.map((a) => a.id)) : pending("not exercised yet");
}

// ------------------------------------------------------------- surface-visit
function surfaceVisits(lw) {
  if (lw.inputMode === "pbi") return [];
  return (lw.model.plan?.surfaces ?? []).filter((s) => s.url).map((s) => ({ subject: s.id, layer: "ui", title: `look at ${s.name ?? s.id}`, sources: [{ from: "map", ref: s.id }], oracle: { kind: "observation", ref: null, authority: null }, can: ["act", "ask"], template: { kind: "act", do: "goto", url: s.url } }));
}

function surfaceState(o, lw) {
  const seen = lw.model.actions.filter((a) => a.state === "done" && (a.surface === o.subject || String(a.on ?? "").startsWith(`${o.subject}/`)));
  return seen.length ? satisfied(`looked at through ${seen.map((a) => a.id).join(", ")}`, seen.map((a) => a.id)) : pending("not looked at yet");
}

// ------------------------------------------------------------------- kinds
// ---------------------------------------------------------- test-obligation
// One per obligation the journal derived, at its latest revision. What settles it is the word its latest execution
// earned (verification.mjs), read through that word's own row: satisfied and violated are final, a word that needs a
// person or a provider waits for one, and anything that may safely be tried again is still owed -- within the
// budgets generate and run-version hold it to.
const latestObligations = (model) => [...new Map((model.obligations ?? []).map((o) => [o.obligation, o])).values()];

function testObligations(lw) {
  return latestObligations(lw.model).map((o) => ({ subject: o.obligation, layer: o.shape, title: `${o.shape} — ${o.target ?? "a node the graph does not hold"}`, sources: (o.bindings ?? []).map((ref) => ({ from: "binding", ref })), oracle: { kind: "plan", ref: o.bindings?.[0] ?? null, authority: o.authority ?? "draft" }, can: ["generate", "run-version", "ask"], template: { kind: "generate", obligation: o.obligation, shape: o.shape, expected: o.expected ?? [], method: o.method ?? null } }));
}

const TEST_STATES = [
  { when: (e) => e.outcome === "SATISFIED", as: (e) => satisfied(`${e.execution} was SATISFIED against its accepted criterion`, [e.id]) },
  { when: (e) => e.outcome === "CONTRADICTED", as: (e) => violated(`${e.execution} CONTRADICTED its accepted criterion`, [e.id]) },
  { when: (e) => e.outcome === "REQUIRES_REQUIREMENT", as: (e) => person(`${e.execution} was REQUIRES_REQUIREMENT — no accepted oracle stands behind it`) },
  { when: (e) => e.outcome === "CAPABILITY_MISSING", as: (e) => blocked("capability", `${e.execution} was CAPABILITY_MISSING — nothing here could perform or observe what it needed`, [e.id]) },
  { when: (e) => verificationOutcomeOf(e.outcome)?.retry === "never" || e.outcome === "AMBIGUOUS", as: (e) => blocked("person", `${e.execution} was ${e.outcome} — a person decides what comes next`, [e.id]) },
  { when: () => true, as: (e) => pending(`${e.execution} was ${e.outcome} — another attempt, or a repaired design, may settle it`) },
];

// The word that stands is the one ACROSS the attempts of its latest version (verification.mjs ATTEMPTS): a contradiction
// another attempt did not repeat is FLAKY, and the last attempt that passed is never chosen over it.
function testObligationState(o, lw) {
  const evaluations = lw.model.evaluations.filter((e) => e.obligation === o.subject);
  const last = evaluations.at(-1);
  if (o.template.method === "manual") return blocked("capability", `${o.template.shape} is represented and counted, and no adapter or oracle can run it yet — a gap, never a pass`);
  return last ? TEST_STATES.find((r) => r.when(standing(evaluations, last))).as(standing(evaluations, last)) : pending(lw.model.versions.length ? "a version may be frozen for it, and nothing it ran has come back yet" : "nothing has been designed for it yet");
}

const versionOfExecution = (execution) => String(execution).split("-").slice(0, 2).join("-");

const standing = (evaluations, last) => ({ ...last, outcome: attemptsOutcome(evaluations.filter((e) => versionOfExecution(e.execution) === versionOfExecution(last.execution)).map((e) => e.outcome)) });

const KINDS = [
  { kind: "post-write", rank: 1, derive: postWrites, state: postWriteState },
  { kind: "finding-need", rank: 2, derive: findingNeeds, state: findingNeedState },
  { kind: "test-obligation", rank: 2.5, derive: testObligations, state: testObligationState },
  { kind: "scenario-layer", rank: 3, derive: scenarioLayers, state: scenarioState },
  { kind: "tenancy-row", rank: 4, derive: tenancyRows, state: tenancyState },
  { kind: "question", rank: 5, derive: openQuestions, state: questionState },
  { kind: "control-effect", rank: 6, derive: controlEffects, state: controlState },
  { kind: "surface-visit", rank: 7, derive: surfaceVisits, state: surfaceState },
];

export const OBLIGATION_KINDS = KINDS.map((k) => ({ kind: k.kind, rank: k.rank }));

// What the report and Control read instead of re-deriving: counts per status,
// what is not settled yet, and the head of the frontier -- at one position.
export function snapshotOf(obligations, position) {
  const counts = Object.fromEntries(obligations.map((o) => o.status).map((st, _, all) => [st, all.filter((x) => x === st).length]));
  return { position, counts, unmet: obligations.filter((o) => !["satisfied", "not-applicable"].includes(o.status)).map((o) => o.id), frontier: frontierOf(obligations).slice(0, 5).map((o) => ({ id: o.id, kind: o.kind, title: o.title })) };
}
