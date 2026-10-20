// The moments in a work's life a person or a host causes: starting it, proposing what it
// needs, settling a need on evidence, and marking where it stands. Each is one locked write to
// the journal and nothing else -- no provider is asked, no requirement read beyond what a
// snapshot lists, no fact's words ever seen.
//
// Nothing here decides anything a person should. A need is SATISFIED only against evidence (a
// receipt of the provider's answer, or a sentence about what showed it), and BLOCKED or NOT
// APPLICABLE only with a reason: the journal has to be able to say why a need stopped, later,
// to somebody who was not there.
import { Refused } from "../errors.mjs";
import { quote } from "../quote.mjs";
import { load, refreshed, standing } from "./resume.mjs";
import { judgeNeeds, MAX_NEEDS } from "./needs.mjs";
import { numbered } from "./model.mjs";
import { workOf, rootOf } from "./store.mjs";
import { SETTLED_STATES } from "./vocab.mjs";

export const MAX_OBJECTIVE = 240;
export const MAX_EVIDENCE = 8;

// The work a ref names: its own id, its requirement's, or the bare id of its item. The same
// number in two systems is two works, and is asked about, never guessed at.
export function findWork(works, ref) {
  const text = String(ref ?? "").trim();
  const found = works.list().filter((id) => id === text || rootOf(id) === text || works.read(id)?.find((l) => l.kind === "created")?.root?.id === text);
  if (found.length > 1) throw new Refused(`${text} names more than one work (${found.join(", ")}) — name one by its w- id`);
  if (!found.length) throw new Refused(`no work is kept for ${text} — start one with work start`);
  return found[0];
}

const adopted = (model) => model.snapshot?.snapshot ?? null;

// A snapshot a work may adopt is one of ITS requirement's, and one that can be read.
function adoptable(w, root, id) {
  const snapshot = w.snapshot(id, root);
  if (!snapshot) throw new Refused(`no snapshot ${id} is kept for this requirement — freeze one with requirements snapshot`);
  return snapshot;
}

function adoption(model, snapshot) {
  const [row] = numbered(model, "snapshot", [{ snapshot: snapshot.id, digest: snapshot.digest, clarity: snapshot.clarity, authority: snapshot.authority }]);
  return row;
}

function adopt(w, id, snapshot) {
  const model = load(w, id);
  if (adopted(model) === snapshot.id) return null;
  return w.works.append(id, "snapshot", adoption(model, snapshot));
}

// Start the work a requirement's item is, or find it: one work per requirement, so "continue
// PBI 4312" is the same work on any host and on any day.
//
// spec: { objective, root, identity, snapshot? }
export function startWork(w, spec) {
  const id = workOf(spec.root);
  const snapshot = spec.snapshot ? adoptable(w, spec.root, spec.snapshot) : null;
  const created = w.works.exists(id) ? false : begun(w, id, spec);
  return w.works.transact(id, () => finished(w, id, snapshot, created));
}

function begun(w, id, spec) {
  const objective = quote(String(spec.objective ?? ""), MAX_OBJECTIVE);
  if (!objective) throw new Refused("a work has an objective: say what it is for");
  return Boolean(w.works.create({ id, objective, root: spec.identity, by: w.by ?? "session", session: w.session ?? undefined, at: w.now() }));
}

function finished(w, id, snapshot, created) {
  const line = snapshot ? adopt(w, id, snapshot) : null;
  return { work: id, created, adopted: line ? line.snapshot : null };
}

// Propose needs: judged as a batch, and kept only if every one holds.
export function addNeeds(w, id, rows) {
  return w.works.transact(id, () => proposed(w, id, rows));
}

// What the work stands on, for the two kinds of dependency.
function worldOf(w, id, model) {
  const snapshot = adopted(model) ? w.snapshot(adopted(model), rootOf(id)) : null;
  return { facts: snapshot ? new Set(snapshot.facts.map((f) => f.id)) : null, needs: new Set(model.needs.keys()) };
}

function proposed(w, id, rows) {
  const model = load(w, id);
  const judged = judgeNeeds(id, rows, worldOf(w, id, model));
  if (judged.rejected.length) throw new Refused(`nothing was added — a batch of needs is all or nothing:\n  ${judged.rejected.join("\n  ")}`);
  return recorded(w, id, model, judged.accepted);
}

function recorded(w, id, model, accepted) {
  const fresh = accepted.filter((n, i) => !model.needs.has(n.id) && accepted.findIndex((x) => x.id === n.id) === i);
  if (model.needs.size + fresh.length > MAX_NEEDS) throw new Refused(`a work holds at most ${MAX_NEEDS} needs — this batch would make ${model.needs.size + fresh.length}; several works are clearer than one enormous one`);
  for (const need of fresh) w.works.append(id, "need", need);
  return { work: id, added: fresh.map(summary), existing: accepted.filter((n) => !fresh.includes(n)).map(summary) };
}

const summary = (n) => ({ need: n.id, type: n.type, subject: n.subject, capability: n.capability ?? null });

// What the files a need is about hash to NOW, when it is settled: the baseline a later look
// is compared with. A path that cannot be hashed cleanly has no baseline, and never makes a
// claim of having moved.
function baselineOf(w, need) {
  if (!need.scope?.length || !w.source) return undefined;
  const now = w.source.fingerprints(need.scope) ?? {};
  return Object.fromEntries(need.scope.filter((p) => now[p]?.hash && !now[p].dirty).map((p) => [p, now[p].hash]));
}

const SETTLE_WHY = { satisfied: (s) => (s.receipt || s.evidence.length ? null : "settling a need as satisfied takes evidence: --receipt=<rct-n> for what a provider answered, or --evidence=\"…\" for what showed it"), blocked: (s) => (s.why ? null : "say why it is blocked: --why=\"…\""), "not-applicable": (s) => (s.why ? null : "say why it is not needed: --why=\"…\"") };

function settlement(spec) {
  if (!SETTLED_STATES.includes(spec.state)) throw new Refused(`--state is one of ${SETTLED_STATES.join(", ")}`);
  const kept = { ...spec, evidence: (spec.evidence ?? []).slice(0, MAX_EVIDENCE) };
  const problem = SETTLE_WHY[spec.state](kept);
  if (problem) throw new Refused(problem);
  return kept;
}

function receipted(model, need, receipt) {
  if (receipt && !model.receipts.some((r) => r.id === receipt && r.need === need && r.outcome === "ok")) throw new Refused(`${receipt} is not an answered receipt of ${need}`);
}

// spec: { need, state, why?, evidence?, receipt? }
export function settleNeed(w, id, spec) {
  const kept = settlement(spec);
  return w.works.transact(id, () => settled(w, id, kept));
}

const settledRow = (w, model, need, spec) => numbered(model, "settled", [{ need: need.id, state: spec.state, receipt: spec.receipt, evidence: spec.evidence.length ? spec.evidence : undefined, why: spec.why, scopes: spec.state === "satisfied" ? baselineOf(w, need) : undefined }])[0];

function settled(w, id, spec) {
  const model = load(w, id);
  const need = model.needs.get(spec.need);
  if (!need) throw new Refused(`there is no need ${spec.need} in this work`);
  receipted(model, need.id, spec.receipt);
  return { work: id, need: need.id, state: w.works.append(id, "settled", settledRow(w, model, need, spec)).state };
}

// Where the work stands, marked: what is stale is found first, what has to be bound is bound,
// and only then is the frontier written down -- so the frontier is never a stale one.
export function checkpointWork(w, id, why) {
  return w.works.transact(id, () => {
    const done = refreshed(w, id);
    const where = standing(w, id);
    const model = load(w, id);
    const [row] = numbered(model, "checkpoint", [{ upto: model.position, frontier: where.frontier.map((f) => f.need), snapshot: where.snapshot ?? undefined, why }]);
    return { ...where, checkpoint: w.works.append(id, "checkpoint", row).id, stale: done.stale, bound: done.bound.bound };
  });
}
