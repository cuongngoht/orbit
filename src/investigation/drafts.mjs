// A REGRESSION DRAFT from a finding -- only when what it would assert is backed
// by an oracle that confirms (src/investigation/vocab.mjs ORACLES), and only
// ever into the machine store's drafts room. An observation is never turned
// into an acceptance criterion by being written down as a case: a finding with
// no accepted oracle gets a `draft` record saying so, and no case.
//
// The case is built from the chain that showed the finding (the map's own
// controls, the data check it took) and goes through the engine's real
// validator before it is kept. Promotion stays a person's explicit request
// (`cli/draft.mjs promote`), as for every agent-authored case.
import { validate } from "../dsl/validate.mjs";
import { encode } from "../dsl/escape.mjs";
import { current, withJournal } from "./act.mjs";
import { recordedCallIn } from "./findings.mjs";
import { actionOf, chainOf, checksOf, nextId } from "./model.mjs";
import { pathOf } from "../network/canonical.mjs";
import { confirms } from "./vocab.mjs";

const SHAPED = new Set(["duplicate", "persistence"]);

// w: { ctx (graph), store, id }; drafts: src/draft createDrafts(...)
export function draftFor(w, findingId, drafts) {
  const model = current(w);
  const f = model.history.find((x) => x.id === findingId);
  const why = f ? notDraftable(model, f) : `${findingId} is not a finding of ${w.id}`;
  if (why) return kept(w, { finding: findingId, case: null, oracle: f?.oracle ?? null, why });
  return validated(w, model, f, caseOf(w, model, f), drafts);
}

function notDraftable(model, f) {
  if (!confirms(f.oracle)) return `its oracle is "${f.oracle}" — no accepted requirement says what should happen, so it stays an observation, not a regression`;
  if (!SHAPED.has(f.family) || !f.action) return `a ${f.family} finding has no case shape here — orbit-qa-case-writer writes one from a plan scenario`;
  return dataCheck(model, f) ? null : "the DSL cannot count requests; a data check on the action is what would make this finding a case";
}

// A SQL check: a count through a capability has no `sql` step to become.
const dataCheck = (model, f) => checksOf(model, f.action).filter((c) => c.layer === "data" && c.query && Number.isInteger(c.expect) && c.state !== "blocked").at(-1) ?? null;

function validated(w, model, f, c, drafts) {
  const problems = validate(c, w.ctx.graph).map(String);
  if (problems.length) return kept(w, { finding: f.id, case: null, oracle: f.oracle, why: `the generated case does not validate: ${problems.slice(0, 3).join("; ")}` });
  drafts.save(c);
  return kept(w, { finding: f.id, case: c.id, oracle: f.oracle, why: "a DRAFT in the machine store — promotion is a person's explicit request" });
}

function kept(w, d) {
  return withJournal(w, () => appendedDraft(w, d));
}

function appendedDraft(w, d) {
  const rec = { ...d, id: nextId(current(w), "draft") };
  w.store.append(w.id, "draft", rec);
  return rec;
}

function caseOf(w, model, f) {
  const chain = chainOf(model, f.action);
  const start = screenAt(w, chain[0]);
  const check = dataCheck(model, f);
  return { id: `aqa-${w.id.slice(4, 12)}-${f.id}`, name: `Regression: ${f.say}`.slice(0, 120), note: `machine-derived by orbit-qa-agent from investigation ${w.id}, finding ${f.id} (oracle: ${f.oracle}); it asserts the record count that oracle backs, nothing merely observed`, start, creates: `the record(s) one ${f.action} writes, named \${NAME}`, params: [{ n: "NAME", required: true }], steps: [...opening(start), ...chain.slice(1).map((a) => stepOf(w, a)), ...apiStep(w, model, f), sqlStep(check), SCREEN], seen: "src" };
}

const screenAt = (w, goto) => [...w.ctx.graph.screens.values()].find((s) => s.url && goto?.target?.startsWith(s.url))?.id ?? goto?.surface ?? null;

const opening = (screen) => [{ do: "goto", screen, wait: "document.body.innerText.length>0" }, { do: "skip-if", js: "document.body.innerText.includes('${NAME}')", why: "a record with this name already exists" }];

function stepOf(w, a) {
  if (a.do === "fill") return { do: "fill", on: a.on, value: "${NAME}" };
  const opens = w.ctx.graph.edgeOn.get(a.on)?.opens;
  return { do: "click", on: a.on, wait: opens === "dialog" ? "document.querySelector('[role=dialog]')" : "document.readyState==='complete'" };
}

// The call the MAP says this control makes, as the action's window answered it
// and as the engine's `api` step asks it -- never merely the first 2xx write,
// which is how a draft once asserted a telemetry call.
function apiStep(w, model, f) {
  const write = recordedCallIn(model, w, actionOf(model, f.action));
  return write && write.status >= 200 && write.status < 300 ? [{ do: "api", match: pathOf(write.template ?? write.endpoint).replace(/^\//, "").split(/\{[a-z]+\}/).map((p) => encode(p, "regex")).join("[^/]+"), method: write.method }] : [];
}

// The engine asks every case to end by recording where the screen was. It
// asserts only that the page answered: the verdict this draft is FOR is the
// sql step's, which the oracle backs -- never a claim about what the screen shows.
const SCREEN = { do: "report", js: "JSON.stringify({path: location.pathname})", expect: "typeof it.path === 'string'" };

function sqlStep(check) {
  const counted = /\bCOUNT\s*\(/i.test(check.query);
  return { do: "sql", query: check.query.replace(/\$\{TC(?::[^}]+)?\}/g, "${NAME}"), expect: counted ? `Number(Object.values(it[0])[0]) === ${check.expect}` : `it.length === ${check.expect}` };
}
