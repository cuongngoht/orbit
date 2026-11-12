// GROUNDING for one task: the `relevant` section and the `sufficiency` word of the project context package (0.5.0,
// B21), composed from the owners that already hold evidence. This file BINDS them and decides nothing:
// src/context/refs.mjs verifies what a host proposed, src/context/relevance.mjs says what the task touches and
// src/context/sufficiency.mjs whether that is enough -- and none of the three imports an owner.
//
//   the tree        the git-only source port over the project's roots (src/architecture/context.mjs `scanRoots`):
//                   ONE listing, ONE identifier search for every proposed symbol, ONE fingerprint call for freshness
//   architecture    every fact the store keeps -- modules, boundaries, the system graph's nodes and relations,
//                   capabilities, gates -- read after the ARCHITECTURE section has ensured them
//   intelligence    the integration facts
//   engineering     what `recall` bears on the task (src/engineering/recall.mjs), near the working set's scopes
//   knowledge       the claims `knowledge claims --for --json` answered, and the paths each one watches
//   working set     what the latest session read and changed
//   impact          once paths are known: runtime understanding's component graph and declared checks, as
//                   src/orchestration/impact.mjs and obligations.mjs read them
//   relations       once the direct files are known: one hop out and one hop in from each, through the relation
//                   adapters of skills/orbit-develop/relations/ (src/context/relations.mjs); a file no adapter reads is
//                   a gap the host fills with `--with-refs`
//   questions       a requirement's blocking question, or a goal's missing prerequisite, already open about the
//                   task's own work -- found, never asked
//   the task's work (0.6.0) its proof needs (the done criteria), whether each is settled and unmoved, and the
//                   evidence its one read model reads back from the linked tasks -- what the three levels rest on
//
// Every read here writes nothing: a store nobody wrote is empty, and an owner that cannot answer is evidence that is
// not there, never a context that fails.
import { scanRoots } from "../src/architecture/context.mjs";
import { withStoredConfig } from "../src/architecture/source.mjs";
import { createArchitecture } from "../src/architecture/store.mjs";
import { capabilityTokens, unanswered } from "../src/architecture/tokens.mjs";
import { relatedOf } from "../src/context/relations.mjs";
import { basisOf, freshened, relevanceOf, seedsOf } from "../src/context/relevance.mjs";
import { symbolHits, treeOf, verifiedRefs } from "../src/context/refs.mjs";
import { directFacts, ownWork, sufficiencyOf } from "../src/context/sufficiency.mjs";
import { watched as engineeringWatched } from "../src/engineering/model.mjs";
import { recall } from "../src/engineering/recall.mjs";
import { createEngineering } from "../src/engineering/store.mjs";
import { factState, scopeState } from "../src/freshness.mjs";
import { createSourceTree } from "../src/frontend/composite.mjs";
import { lifecycleOf } from "../src/goal/lifecycle.mjs";
import { modelOf as goalModelOf } from "../src/goal/model.mjs";
import { createGoals } from "../src/goal/store.mjs";
import { createIntelligence } from "../src/intelligence/store.mjs";
import { watched as claimWatched } from "../src/knowledge/model.mjs";
import { createKnowledge } from "../src/knowledge/store.mjs";
import { checksOf } from "../src/orchestration/checks.mjs";
import { planOf } from "../src/orchestration/obligations.mjs";
import { createRequirements } from "../src/requirements/store.mjs";
import { isOpen } from "../src/requirements/vocab.mjs";
import { MAX_EVIDENCE_FILES } from "../src/runtime/discover/readers/index.mjs";
import { componentGraphOf } from "../src/runtime/graph.mjs";
import { look } from "../src/runtime/understanding.mjs";
import { machineContext } from "../src/store/context.mjs";
import { tokens } from "../src/tokens.mjs";
import { CHECKS as CHECK_CLASSES } from "../src/engineering/working-set/collect.mjs";
import { sessionActivityOf, sessionLinesOf } from "../src/live/session.mjs";
import { workingSetDir } from "../src/project/runtime.mjs";
import { realIo } from "../src/store/io.mjs";
import { COMMANDS as TASK_COMMANDS } from "../src/task/index.mjs";
import { createTasks } from "../src/task/store.mjs";
import { INVALIDATE } from "../src/work/freshness.mjs";
import { modelOf as workModelOf, statesOf as needStatesOf } from "../src/work/model.mjs";
import { listed } from "../src/work/summary.mjs";
import { readView } from "../src/work/track/read.mjs";
import { workingSetOf } from "../src/work/track/tail.mjs";
import { createWorks, rootOf } from "../src/work/store.mjs";
import { MAX_WORKS, namesWork } from "../src/work/views/recall.mjs";
import { RELATION_ADAPTERS } from "../skills/orbit-develop/relations/index.mjs";
import { bindRuntime } from "../skills/orbit-runtime/bind.mjs";

function quietly(fn, otherwise = null) {
  try { return fn() ?? otherwise; }
  catch { return otherwise; }
}

// ---- what is bound once ---------------------------------------------------------------------------------------------

function bound(w) {
  const ctx = { project: w.project, config: w.project.config };
  const machine = machineContext(ctx, w.env);
  const source = withStoredConfig(createSourceTree(scanRoots(ctx)), w.project);
  return { ...w, root: machine.store.root, io: machine.io, source };
}

const rooms = (b) => ({ arch: createArchitecture(b.root, b.io), intel: createIntelligence(b.root, b.io), eng: createEngineering(b.root, b.io), know: createKnowledge(b.root, b.io) });

// ---- the tree, and what the host proposed ---------------------------------------------------------------------------

// ONE search of the index for every proposed symbol (src/context/refs.mjs `symbolHits`); a search that throws could not run.
const hitsOf = (b, refs) => symbolHits(refs, (pattern) => quietly(() => b.source.search(pattern)), Date.now);

function treeAndRefs(b) {
  const tree = treeOf(quietly(() => b.source.files()));
  const refs = verifiedRefs(b.refs, { ...(tree ?? {}), hits: hitsOf(b, b.refs), maxFiles: MAX_EVIDENCE_FILES });
  return { tree, refs };
}

// ---- what each owner holds -------------------------------------------------------------------------------------------

const engineeringFor = (b, r) => recall(quietly(() => r.eng.all(), []), { asked: tokens(b.task), near: b.workingSet?.scopes ?? [] }).map((row) => row.fact);

const answeredRows = (json) => (json?.answers ?? []).flatMap((a) => [...(a.prevails ?? []), ...(a.rivals ?? []), ...(a.conditional ?? [])]);

const claimOf = (r, row) => ((claim) => (claim ? { id: claim.id, subject: claim.subject, object: claim.object, paths: claimWatched(claim), measured: row.measured } : null))(quietly(() => r.know.find(row.id)));

// The knowledge owner's own answer for the task -- asked only when the store holds a claim to answer with.
const knowledgeFor = (b, r) => (quietly(() => r.know.count(), 0) > 0 ? answeredRows(quietly(() => b.claims())).map((row) => claimOf(r, row)).filter(Boolean) : []);

function evidenceOf(b, r, seen) {
  const architecture = quietly(() => r.arch.all(), []);
  const intelligence = quietly(() => r.intel.all(), []).filter((f) => f.kind === "integration");
  const workingSet = { changed: b.workingSet?.changed ?? [], read: b.workingSet?.read ?? [] };
  return { task: b.task, tree: seen.tree, refs: seen.refs.held, architecture, intelligence, engineering: engineeringFor(b, r), knowledge: knowledgeFor(b, r), workingSet };
}

// ---- what the paths reach, once they are known --------------------------------------------------------------------

// A task's look, as obligations.mjs reads one, with nothing done yet: the paths are its plan's scope.
const lookAt = (paths, components) => ({ view: { changes: { paths: [] }, actions: [], receipts: [] }, events: [], checks: checksOf(components), planned: () => paths, graph: () => componentGraphOf(components) });

function reached(seen, paths) {
  const components = seen.view?.components ?? [];
  if (!components.length) return { graph: false, state: seen.state, plan: null };
  const plan = planOf(lookAt(paths, components));
  return { graph: true, state: seen.state, plan: { components: plan.impact.components, checks: plan.required.map((c) => ({ id: c.id, component: c.component, declaredAs: c.declaredAs })) } };
}

function impactFor(b, paths) {
  if (!paths.length) return { graph: false, state: null, plan: null };
  const rt = quietly(() => bindRuntime({ pluginRoot: b.pluginRoot, env: b.env, cwd: b.cwd }));
  const seen = rt ? quietly(() => look(rt)) : null;
  return seen ? reached(seen, paths) : { graph: false, state: null, plan: null };
}

// ---- the direct files' own relations, one hop each way --------------------------------------------------------------

// The pack's adapters (skills/orbit-develop/relations/) read what each file imports; the walk (src/context/relations.mjs)
// reads only the direct files, from the committed tree, and asks the index one search per file and per route literal.
const relationsFor = (b, seen, listing) => relatedOf({ direct: seedsOf(listing), tree: seen.tree, adapters: RELATION_ADAPTERS, read: (path) => quietly(() => b.source.read(path)), search: (pattern) => quietly(() => b.source.search(pattern)), maxFiles: MAX_EVIDENCE_FILES });

// ---- freshness: each record against its OWN owner's scope fingerprints ---------------------------------------------

const byId = (facts) => new Map(facts.map((f) => [f.id, f]));

const FACT_SCOPES = { architecture: (f) => f.scope ?? [], intelligence: (f) => f.scope ?? [], engineering: (f) => engineeringWatched(f) };

const scopesOfBasis = (basis, facts) => basis.flatMap((x) => (FACT_SCOPES[x.owner] ? FACT_SCOPES[x.owner](facts[x.owner].get(x.id) ?? {}) : x.owner === "tree" ? [x.id] : []));

const measuredScopes = (scopes, now, model) => Object.fromEntries(scopes.map((s) => [s, scopeState(now[s] ?? null, model?.scopes?.[s]?.hash)]));

const factStateOf = (fact, now, model, scopes) => (fact ? factState({ scope: scopes(fact) }, measuredScopes(scopes(fact), now, model)) : "unknown");

const UNDERSTOOD = { CURRENT: "fresh", STALE: "stale" };

const STATE = {
  architecture: (x, m) => factStateOf(m.facts.architecture.get(x.id), m.now, m.models.architecture, FACT_SCOPES.architecture),
  intelligence: (x, m) => factStateOf(m.facts.intelligence.get(x.id), m.now, m.models.intelligence, FACT_SCOPES.intelligence),
  engineering: (x, m) => factStateOf(m.facts.engineering.get(x.id), m.now, m.models.engineering, FACT_SCOPES.engineering),
  knowledge: (x, m) => m.claims.get(x.id) ?? "unknown",
  tree: (x, m) => scopeState(m.now[x.id] ?? null, m.now[x.id]?.hash).state,
  plan: (x, m) => UNDERSTOOD[m.understood] ?? "unknown",
};

const modelsOf = (r) => ({ architecture: quietly(() => r.arch.model().model), intelligence: quietly(() => r.intel.model().model), engineering: quietly(() => r.eng.model().model) });

function measuring(b, r, input, basis) {
  const facts = { architecture: byId(input.architecture), intelligence: byId(input.intelligence), engineering: byId(input.engineering) };
  const scopes = [...new Set(scopesOfBasis(basis, facts))];
  const now = scopes.length ? quietly(() => b.source.fingerprints(scopes), {}) : {};
  return { facts, now, models: modelsOf(r), claims: new Map(input.knowledge.map((c) => [c.id, c.measured])) };
}

function statesOf(b, r, input, listing, understood) {
  const basis = basisOf(listing);
  const m = { ...measuring(b, r, input, basis), understood };
  return Object.fromEntries(basis.map((x) => [`${x.owner}:${x.id}`, STATE[x.owner]?.(x, m) ?? "unknown"]));
}

// ---- the questions already open about the task's own work ---------------------------------------------------------

const openQuestions = (b, root) => quietly(() => createRequirements(b.root, b.io).open(root).questions(), []).filter((q) => isOpen(q) && q.blocking === true).map((q) => ({ flow: "requirements", root, id: q.id, asks: q.asks }));

// The task's OWN work and goal (src/context/sufficiency.mjs `ownWork`): named by id, or mostly the task's own words --
// never one that merely shares two words with it, whose question this task must not wait on.
const ownedWork = (b, head) => head.root && (namesWork(head, b.task) || ownWork(head.objective, b.task));

const requirementQuestions = (b) => quietly(() => listed(createWorks(b.root, b.io)), []).filter((head) => ownedWork(b, head)).slice(0, MAX_WORKS).flatMap((head) => openQuestions(b, rootOf(head.id)));

const goalAbout = (b, id, model) => b.task.includes(id) || ownWork(model.analyzed?.objective ?? model.meta?.title ?? "", b.task);

const missingOf = (id, model) => (lifecycleOf(model) === "waiting-input" ? model.analyzed?.intent?.missing ?? [] : []).map((m) => ({ flow: "goal", goal: id, asks: m.statement, blocks: m.blocks ?? [] }));

const goalQuestionsOf = (b, goals, id) => quietly(() => ((model) => (goalAbout(b, id, model) ? missingOf(id, model) : []))(goalModelOf(goals.read(id) ?? [])), []);

const goalQuestions = (b) => ((goals) => quietly(() => goals.list(), []).flatMap((id) => goalQuestionsOf(b, goals, id)))(createGoals(b.root, b.io));

// ---- the task's own work: its done criteria, and what its owners say of them (0.6.0, U1) ----------------------------

// Which work is the task's: the one `--work=` names, else the ONE work the task names by id or mostly restates -- two
// candidates are ambiguous, never the newest.
const candidateWorks = (b) => quietly(() => listed(createWorks(b.root, b.io)), []).filter((head) => namesWork(head, b.task) || ownWork(head.objective, b.task));

const ownWorkId = (b) => b.work ?? ((heads) => (heads.length === 1 ? heads[0].id : null))(candidateWorks(b));

// The work's evidence as its one read model says it (src/work/track/read.mjs), read back from the linked tasks' owners.
const viewContext = (b, works) => ({ works, nowMs: Date.now(), idleAfterMs: 120_000, checkout: b.project.checkoutId ?? null, host: null, workingSet: workingSetOf(realIo(), quietly(() => workingSetDir(b.project)) ?? b.root, "ok"), activity: { linesOf: sessionLinesOf, activityOf: sessionActivityOf, checks: CHECK_CLASSES }, taskView: (id) => TASK_COMMANDS.show.run({ tasks: createTasks(b.root, b.io), checkout: b.project.checkoutId ?? null, now: () => new Date().toISOString() }, [id]) });

const evidenceLevel = (b, works, id) => quietly(() => readView(viewContext(b, works), id).evidence.level, "none");

// A proof need settled on files that moved since -- asked read-only of the work's own scope rule (src/work/freshness.mjs),
// which writes nothing; only `work checkpoint` and `work resume` record a move.
const SCOPE_RULE = INVALIDATE.find((row) => row.name === "scope");

const movedOf = (b, model, proofs) => new Set(quietly(() => SCOPE_RULE.find({ source: b.source }, model), []).map((row) => row.need).filter((need) => proofs.some((p) => p.need === need))).size;

function workFactsOf(b, works, id) {
  const model = workModelOf(works.read(id) ?? []);
  const proofs = needStatesOf(model).filter((n) => n.type === "proof" && n.state !== "not-applicable");
  return { id, proofs: proofs.length, unproved: proofs.filter((n) => n.state !== "satisfied").length, moved: movedOf(b, model, proofs), evidence: evidenceLevel(b, works, id) };
}

const workFacts = (b) => ((id) => (id ? quietly(() => workFactsOf(b, createWorks(b.root, b.io), id)) : null))(ownWorkId(b));

// ---- the package's two answers --------------------------------------------------------------------------------------

const summaryOf = (listing, refs, relations) => ({ total: listing.total, listed: listing.items.length, more: listing.more, byClass: listing.byClass, refused: refs.refused, gaps: relations?.gaps ?? [] });

const capabilityGaps = (b, input) => unanswered(input.architecture.filter((f) => f.kind === "capability"), capabilityTokens(b.task));

const levelFacts = (b, listing, judged) => ({ ...directFacts(judged.fresh.relevant, judged.held), followed: seedsOf(listing).length, work: workFacts(b) });

const sufficiencyFor = (b, input, listing, judged) => sufficiencyOf({ tree: Boolean(input.tree), classes: listing.byClass, stale: judged.fresh.stale, paths: listing.paths.length, graph: judged.reach.graph, understood: judged.reach.state, unanswered: capabilityGaps(b, input), refused: judged.refused, blocking: [...requirementQuestions(b), ...goalQuestions(b)], ...levelFacts(b, listing, judged) });

function grounded(b) {
  const r = rooms(b);
  const seen = treeAndRefs(b);
  const input = evidenceOf(b, r, seen);
  const first = relevanceOf(input);
  return finished(b, r, { ...input, relations: relationsFor(b, seen, first) }, seen.refs, impactFor(b, first.paths));
}

function finished(b, r, given, refs, reach) {
  const input = { ...given, plan: reach.plan };
  const listing = relevanceOf(input);
  const fresh = freshened(listing, statesOf(b, r, input, listing, reach.state));
  return { relevant: fresh.relevant, relevance: summaryOf(listing, refs, input.relations), sufficiency: sufficiencyFor(b, input, listing, { fresh, reach, refused: refs.refused.length, held: refs.held }) };
}

// No checkout -- or nothing here could be composed: no tree to verify anything against, so every proposed reference is
// refused, nothing is listed, and what stopped it is said.
function ungrounded(w, problem) {
  const refs = verifiedRefs(w.refs, null);
  const listing = relevanceOf({ task: w.task, tree: null });
  return { relevant: [], relevance: { ...summaryOf(listing, refs), ...(problem ? { problem } : {}) }, sufficiency: sufficiencyOf({ tree: false, classes: listing.byClass, refused: refs.refused.length }) };
}

const firstLine = (e) => String(e?.message ?? e).split("\n")[0].slice(0, 200);

// -> { relevant, relevance: { total, listed, more, byClass, refused, gaps, problem? }, sufficiency }
//    w: { env, pluginRoot, cwd, project (or null), task, refs (as the host sent them), workingSet (the fold),
//         claims: () => what `knowledge claims --for --json` answered (or null), work: the w-… `--work=` named (or null) }
export function groundingOf(w) {
  if (!w.project) return ungrounded(w);
  try { return grounded(bound(w)); }
  catch (e) { return ungrounded(w, `the relevant section could not be composed here: ${firstLine(e)}`); }
}
