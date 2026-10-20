// Every step a decision may take, as rows -- and nothing else it can do.
//
// A row says which fields the step may carry and which it must (an inner list
// means one of them), the modes it may run in, whether it can WRITE (which is
// what makes a step that never settled AMBIGUOUS rather than safe to retry), and
// which engine operation it IS: the same function the CLI calls, inside the
// same gates. There is no free-form step, no command string and no second way
// to reach the browser, the database or a capability.
import { Refused } from "../errors.mjs";
import { CORE } from "../dsl/registry.mjs";
import { act, withJournal } from "./act.mjs";
import { checkData } from "./data.mjs";
import { modelOf, nextId } from "./model.mjs";
import { reproduce } from "./reproduce.mjs";
import { linkRun } from "./runs.mjs";
import { runMatrix } from "./security.mjs";
import { isDestructiveCase } from "./obligations.mjs";
import { controlOf } from "./surfaces.mjs";
import { matrixOf } from "./tenancy.mjs";

const SYNTHETIC = /^TC-[A-Za-z0-9-]{1,60}$/;

const writesAt = (lw, on) => Boolean(on && lw.ctx.graph.edgeOn.get(on) && controlOf(lw.ctx.graph, lw.ctx.graph.edgeOn.get(on)).writes);

// A case writes if it says so, or a step of it changes a control the map says writes.
function caseWrites(lw, a) {
  const c = lw.findCase?.(a.case, Boolean(a.draft));
  if (!c) throw new Refused(`no ${a.draft ? "draft " : ""}case ${a.case} — run-case takes a case in the checkout, or a draft with draft: true`);
  const changes = CORE.verbsWhere("changes");
  return Boolean(c.creates || c.destructive) || (c.steps ?? []).some((s) => changes.has(s.do) && writesAt(lw, s.on));
}

// No mode runs a destructive case: a person reads it with --dry and runs it on
// purpose, exactly as the runner's own gate asks (src/run/gates/destructive.mjs).
const CASE_PROBLEMS = [
  { fails: (a, lw) => isDestructiveCase(lw, a.case, Boolean(a.draft)), say: (a) => `${a.case} is destructive — the loop never runs one; a person reads it with --dry and runs it on purpose (run-case --force-destructive)` },
  { fails: (a) => !Object.values(a.params ?? {}).every((v) => SYNTHETIC.test(String(v))), say: () => "run-case params are synthetic TC- values only" },
];

const caseProblem = (a, lw) => CASE_PROBLEMS.find((p) => p.fails(a, lw))?.say(a) ?? null;

const updatesIn = (lw, rows) => matrixOf(lw.settings.tenancy ?? { tenants: {}, identities: {}, resources: {}, matrix: [] }).some((r) => (!rows || rows.includes(r.row)) && r.operation === "update");

export const ACTIONS = {
  act: { fields: ["do", "on", "url", "value", "identity"], required: ["do"], modes: "any; a control the map says writes needs explore-write (the act gates say so)", allowed: () => true, mutates: (a, lw) => a.do !== "goto" && writesAt(lw, a.on), check: (a) => (["goto", "click", "fill"].includes(a.do) ? null : "act.do is goto, click or fill"), run: (w, a) => act(w, { kind: a.do, on: a.on, url: a.url, value: a.value, identity: a.identity }) },
  "check-data": { fields: ["action", "query", "via", "input", "expect", "within"], required: ["action", ["query", "via"]], modes: "any — it only reads", allowed: () => true, mutates: () => false, check: () => null, run: (w, a) => checkData(w, a) },
  security: { fields: ["rows"], required: [], modes: "security-test", allowed: (m) => m === "security-test", mutates: (a, lw) => updatesIn(lw, a.rows), check: (a) => (a.rows === undefined || (Array.isArray(a.rows) && a.rows.every(Number.isInteger)) ? null : "security.rows is a list of matrix row numbers"), run: (w, a) => runMatrix({ ...w, mode: "security-test" }, a.rows ?? null) },
  reproduce: { fields: ["finding"], required: ["finding"], modes: "any; replaying a write needs explore-write (the act gates say so)", allowed: () => true, mutates: (a, lw) => reproducesWrite(lw, a.finding), check: () => null, run: (w, a) => reproduce(w, a.finding) },
  "run-case": { fields: ["case", "draft", "params"], required: ["case"], modes: "any; a case that writes needs explore-write; a destructive case never", allowed: (m, a, lw) => !caseWrites(lw, a) || m === "explore-write", mutates: (a, lw) => caseWrites(lw, a), check: (a, lw) => caseProblem(a, lw), run: (w, a) => ranCase(w, a) },
  ask: { fields: ["asks"], required: ["asks"], modes: "any", allowed: () => true, mutates: () => false, check: (a) => (typeof a.asks === "string" && a.asks.trim() && a.asks.length <= 400 ? null : "ask.asks is one question, 400 characters at most"), run: (w, a, d) => asked(w, a, d) },
};

export const ACTION_KINDS = Object.keys(ACTIONS);

// A reproduction replays the chain the finding named; it writes if any control on it does.
function reproducesWrite(lw, findingId) {
  const f = lw.model.history.find((x) => x.id === findingId);
  const chain = f?.action ? lw.model.actions.slice(0, lw.model.actions.findIndex((a) => a.id === f.action) + 1) : [];
  return chain.some((a) => a.do !== "goto" && writesAt(lw, a.on));
}

// The composition root binds `runCase`: it spawns run-case by path, argv only,
// and triages the result (cli/autonomous-qa.mjs). Nothing under src/ spawns.
function ranCase(w, a) {
  if (typeof w.runCase !== "function") throw new Refused("this engine was not given a way to run a case here — cli/autonomous-qa.mjs binds one");
  const facts = w.runCase(a.case, { draft: Boolean(a.draft), params: a.params ?? {} });
  return linkRun(w, { ...facts, authority: a.draft ? "draft" : "accepted" });
}

// A requirement question, put on the journal for a PERSON; the obligation it is
// about waits for the answer (src/investigation/obligations.mjs).
function asked(w, a, d) {
  return withJournal(w, () => w.store.append(w.id, "question", { id: nextId(modelOf(w.store.read(w.id)), "question"), obligation: d.target, decision: d.id, asks: a.asks }));
}
