// A DECLARED PLAYBOOK, RUN by the engine (0.0.4): the coordinator's engine step for a playbook step whose provider is
// a project playbook that declares its workflow (src/skill-factory/workflow.mjs). Every call it makes goes through the
// door its provider is behind -- a managed server's broker, a project capability's pipeline (src/work/invoke.mjs
// invokeBound) -- picked by the resolver at the moment the step runs, and asked for reading only. Nothing here is a
// tool executor: it holds a run to its pinned version, records each step BEFORE it is asked, keeps what each call
// came to as receipts in the coordinator's own journal, and reads the outputs a later step needs off the answer,
// in memory, never kept.
//
//   1  the PIN: the one this run already holds (a later attempt keeps it, whatever was registered since), the version
//      this workflow registered, or the version the resolver's playbook has in place -- recorded before anything runs
//   2  the version read back from wherever it is kept, its files proved to be what was verified, its workflow held to
//      the contract again; a playbook a person switched off runs nothing
//   3  each step in dependency order: settled before (and not read from again) -> kept; may not run now (a step it
//      reads from did not answer, the budget is spent, an input is missing) -> recorded why; else resolved NOW,
//      approved when it must be, started (`act-start`, `skillstep … RUNNING`), asked with its retries and timeout,
//      every call an `invocation` receipt, then judged: its output contract, and an owner's record when it names one
//   4  the run settled from its steps: VERIFIED only when every required step is; REPORTED when they answered and met
//      their contracts with nothing to prove them by; FAILED; or BLOCKED, waiting for someone
//
// ports: task · resolve · invoke ({ bind(resolved), call(binding, ask) }) · factory ({ workflow(pin), current(id),
// interpreter }) · investigations · child · requirements · now   (cli/automation.mjs binds them; this imports no subject)
import { canonicalJson, short } from "../hash.mjs";
import { scrub } from "../scrub.mjs";
import { READ_BACK } from "./evidence.mjs";
import { BLOCKS, CALLED_UNDER, RUN_WORD, SKILL_STEP, stepWord } from "./skill-run-vocab.mjs";
import { ACTION_TYPE, DOMAIN, NEEDS } from "./vocab.mjs";

const clip = (text) => String(text ?? "").slice(0, 240) || undefined;

const quietly = (fn) => {
  try { return fn(); }
  catch { return null; }
};

const DEFAULT_TIMEOUT_MS = 30000;

// The run's clock is the coordinator's (`ports.now`), never the machine's own: a test's clock is the clock.
const nowMs = (ports) => Date.parse(ports.now());
const MAX_CALLS = 16;

// A run is one playbook step of one workflow: its id is the same on every attempt, so a later attempt RESUMES it.
export const runIdOf = (task, step) => `srun-${short(`${task}\u0000${step}`, 12)}`;

const stepRef = (c, id) => `${c.run}.${id}`;

const toolSlug = (id) => String(id).toLowerCase().replace(/[^a-z0-9.-]+/g, "-").replace(/^[^a-z]+/, "").slice(0, 64) || "provider";

// ---- the pin -------------------------------------------------------------------------------------

const receiptsIn = (view, domain) => view.receipts.filter((r) => r.domain === domain);

const priorPin = (lw, run) => receiptsIn(lw.view, DOMAIN.SKILLRUN).find((r) => r.ref === run)?.pin ?? null;

// The version this workflow's own register step registered for the playbook, newest first.
const registeredPin = (lw, id) => receiptsIn(lw.view, DOMAIN.SKILL).filter((r) => r.ref.startsWith(`${id}:`) && r.outcome !== "PINNED" && r.outcome !== "REUSED" && r.outcome !== "REFUSED").at(-1)?.ref ?? null;

const currentPin = (ports, id) => ((row) => (row?.offered ? row.pin : null))(quietly(() => ports.factory.current(id)));

// Which version a playbook step runs, and whether this workflow registered it (PINNED) or found it (REUSED).
export function pinFor(ports, lw, run, provider) {
  const held = priorPin(lw, run);
  if (held) return { pin: held, word: null };
  const own = registeredPin(lw, provider.id);
  return own ? { pin: own, word: "PINNED" } : ((pin) => (pin ? { pin, word: "REUSED" } : null))(currentPin(ports, provider.id));
}

// A followed playbook is pinned the same way before a host is handed it (dispatch.mjs BEFORE_HOST).
export const pinReceipt = (pinned, provider) => ({ domain: DOMAIN.SKILL, ref: pinned.pin, outcome: pinned.word, summary: clip(`${pinned.word === "REUSED" ? "reused" : "pinned"}: ${provider.id} runs as ${pinned.pin} for this workflow — a version registered later changes nothing here`) });

// ---- opening the run --------------------------------------------------------------------------------

const blockedRead = (needs, because) => ({ verdict: "blocked", needs, receipt: null, because: clip(because) });

// A playbook a person switched off (disabled, retired, archived) runs no version at all; a version that was only
// superseded by a later registration still runs for the run that pinned it.
const switchedOff = (ports, id) => ((row) => !row || row.archived || row.status !== "active")(quietly(() => ports.factory.current(id)));

function loaded(ports, pin, id) {
  if (switchedOff(ports, id)) return { read: blockedRead(NEEDS.PERSON, `${BLOCKS.SKILL_UNAVAILABLE}: ${id} is not active for this project — a person switched it off, so no version of it runs`) };
  try { return { version: ports.factory.workflow(pin) }; }
  catch (e) { return { read: { verdict: "violated", receipt: null, because: clip(scrub(e.message)) } }; }
}

// What earlier attempts of this run recorded for each step: the newest word of each `skillstep` receipt.
const priorWords = (lw, run) => new Map(receiptsIn(lw.view, DOMAIN.SKILLSTEP).filter((r) => r.ref.startsWith(`${run}.`)).map((r) => [r.ref.slice(run.length + 1), r.outcome]));

const invocationsOf = (lw, run) => receiptsIn(lw.view, DOMAIN.INVOCATION).filter((r) => r.ref.startsWith(`${run}.`)).length;

const activeAction = (lw, step) => lw.states.find((s) => s.id === step.id)?.action ?? null;

function runContext(ports, lw, step, base) {
  const ip = ports.factory.interpreter;
  return { ports, lw, task: lw.id, step, act: activeAction(lw, step), run: base.run, pin: base.pin, skill: base.provider.id, wf: base.version.workflow, ip, order: ip.orderOf(base.version.workflow), scope: { context: { objective: lw.view.task.objective, ref: lw.ref ?? null }, outputs: new Map() }, prior: priorWords(lw, base.run), words: new Map(), stop: null, calls: 0, invocations: invocationsOf(lw, base.run), started: nowMs(ports), plan: lw.plan?.n ?? null };
}

const apply = (c, op, given) => c.ports.task.apply(c.task, op, given);

function opened(ports, lw, step, base) {
  const c = runContext(ports, lw, step, base);
  if (base.word) apply(c, "link-receipt", { ...pinReceipt(base, base.provider), action: c.act });
  apply(c, "link-receipt", { domain: DOMAIN.SKILLRUN, ref: c.run, outcome: RUN_WORD.RUNNING, pin: c.pin, action: c.act, summary: clip(`plan-${c.plan ?? "?"} · ${c.pin} · ${c.order.length} step(s): ${c.order.join(", ")}`) });
  return c;
}

function prepared(ports, lw, step, provider) {
  const run = runIdOf(lw.id, step.id);
  const pinned = pinFor(ports, lw, run, provider);
  if (!pinned) return { read: blockedRead(NEEDS.CAPABILITY, `${BLOCKS.SKILL_UNAVAILABLE}: ${provider.id} has no version this workflow may run — none was registered by it, and none is active`) };
  const got = loaded(ports, pinned.pin, provider.id);
  return got.read ? got : { c: opened(ports, lw, step, { run, provider, ...pinned, version: got.version }) };
}

// ---- one step: may it run now? ---------------------------------------------------------------------------

const wordOf = (c, id) => c.words.get(id) ?? null;

const readsFrom = (s, id) => Object.values(s.input ?? {}).some((b) => typeof b?.from === "string" && b.from.startsWith(`steps.${id}.`));

// A step settled by an earlier attempt is kept -- unless a step still to run reads its outputs, which are never kept:
// then it is asked again (it read, so asking again changes nothing).
const neededLater = (c, id) => c.order.some((other) => other !== id && !stepWord(c.prior.get(other))?.done && readsFrom(c.ip.stepOf(c.wf, other), id));

const keptFromBefore = (c, s) => stepWord(c.prior.get(s.id))?.done === true && !neededLater(c, s.id);

const neverAgain = (c, s) => c.prior.has(s.id) && stepWord(c.prior.get(s.id))?.again === false && !stepWord(c.prior.get(s.id))?.done;

const unanswered = (c, s) => (s.after ?? []).filter((a) => !stepWord(wordOf(c, a))?.done);

const spent = (c) => c.calls >= (c.wf.bounds?.maxCalls ?? MAX_CALLS) || nowMs(c.ports) - c.started > (c.wf.bounds?.maxMs ?? Infinity);

const contextMissing = (c, s, input) => input.missing.some((k) => String(s.input[k]?.from ?? "").startsWith("context."));

// Why a step does not run now: the first row that holds, or none.
const BEFORE = [
  { when: (c) => c.stop !== null, then: () => null },
  { when: keptFromBefore, then: (c, s) => c.words.set(s.id, c.prior.get(s.id)) },
  { when: neverAgain, then: (c, s) => settledWithout(c, s, { word: SKILL_STEP.AMBIGUOUS, needs: NEEDS.PERSON, because: `${s.id} was interrupted while it may have changed something — it is never asked again; a person decides` }) },
  { when: (c, s) => unanswered(c, s).length > 0, then: (c, s) => settledWithout(c, s, { word: SKILL_STEP.SKIPPED, because: `a step it waits for did not answer: ${unanswered(c, s).join(", ")}` }) },
  { when: spent, then: (c, s) => settledWithout(c, s, { word: SKILL_STEP.BLOCKED, needs: NEEDS.PERSON, because: `${BLOCKS.BUDGET}: the workflow's bounds are spent (${c.calls} call(s))` }) },
];

// ---- one step: recording what it came to -------------------------------------------------------------

const required = (s) => s.required !== false;

// What a step's word does to the run: a required step that failed or waits stops it; anything optional is only recorded.
function judgedWord(c, s, j) {
  c.words.set(s.id, j.word);
  if (required(s) && (stepWord(j.word).fails || stepWord(j.word).waits)) c.stop = { word: j.word, step: s.id, needs: j.needs ?? NEEDS.PERSON, because: j.because };
  return j;
}

const stepReceipt = (c, s, j, act) => ({ domain: DOMAIN.SKILLSTEP, ref: stepRef(c, s.id), outcome: j.word, action: act ?? c.act, summary: clip(`${j.because ?? stepWord(j.word).say}`) });

// A step that never started an action: its word, linked to the playbook step's own action.
function settledWithout(c, s, j) {
  apply(c, "link-receipt", stepReceipt(c, s, j, null));
  return judgedWord(c, s, j);
}

const ENDS = { VERIFIED: "succeeded", CONTRACT_MET: "succeeded" };

// A step that started its own action: its word, then how the action ended.
function settledWith(c, s, j, act) {
  apply(c, "link-receipt", stepReceipt(c, s, j, act));
  apply(c, ENDS[j.word] ? "act-complete" : "act-fail", ENDS[j.word] ? { action: act, outcome: ENDS[j.word], receipt: `${DOMAIN.SKILLSTEP}:${stepRef(c, s.id)}`, summary: clip(j.because) } : { action: act, reason: clip(j.because ?? j.word), receipt: `${DOMAIN.SKILLSTEP}:${stepRef(c, s.id)}` });
  return judgedWord(c, s, j);
}

// ---- one step: who serves it, now ---------------------------------------------------------------------

const servable = (p) => p.kind === "mcp" || (p.kind === "capability" && p.ownership === "project");

// The resolver's answer for the step's capability as it stands NOW -- a provider switched off since the plan was made
// stops the step here -- and the binding its door is asked through.
const CHOICE = [
  { when: (r) => !r || r.outcome !== "provided" || !r.provider, then: (c, s, r) => ({ word: SKILL_STEP.BLOCKED, needs: r?.remedy === "enable" ? NEEDS.PERSON : NEEDS.CAPABILITY, because: `${BLOCKS.TOOL_UNAVAILABLE}: nothing may serve ${s.capability} now — ${r?.why ?? "the resolver could not tell"}` }) },
  { when: (r) => !servable(r.provider), then: (c, s, r) => ({ word: SKILL_STEP.BLOCKED, needs: NEEDS.CAPABILITY, because: `${BLOCKS.HOST_ONLY}: ${s.capability} is served by ${r.provider.kind} ${r.provider.id}, which a workflow step never runs` }) },
  { when: () => true, then: (c, s, r) => bound(c, s, r) },
];

function bound(c, s, r) {
  const binding = quietly(() => c.ports.invoke.bind(r));
  if (!binding) return { word: SKILL_STEP.BLOCKED, needs: NEEDS.ENVIRONMENT, because: `${BLOCKS.TOOL_UNAVAILABLE}: ${r.provider.id} is not in the registry any more` };
  return { binding, provider: r.provider, asks: s.approval === "owner" || r.status === "approval" };
}

const chosenFor = (c, s) => ((r) => CHOICE.find((row) => row.when(r)).then(c, s, r))(quietly(() => c.ports.resolve(s.capability)));

// ---- one step: a person's approval, at the moment it would run -------------------------------------------

// Exactly what would start: the step, its provider and a digest of its input -- never the input itself.
const gateOf = (c, s, chosen, input) => ({ type: ACTION_TYPE.SKILL_STEP, tool: toolSlug(chosen.provider.id), environment: "local", params: { run: c.run, step: s.id, provider: chosen.provider.key, capability: s.capability, input: short(canonicalJson(input), 16) } });

const fingerprintsAsked = (c) => new Map(c.ports.task.events(c.task).filter((e) => e.kind === "approval-requested").map((e) => [e.id, e.fingerprint]));

const approvalsFor = (c, fp) => ((byId) => c.ports.task.view(c.task).approvals.filter((a) => byId.get(a.id) === fp))(fingerprintsAsked(c));

const APPROVAL = [
  { when: (list) => list.some((a) => a.state === "granted"), then: (c, s, list) => ({ approval: list.find((a) => a.state === "granted").id }) },
  { when: (list) => list.some((a) => a.state === "pending"), then: (c, s, list) => ({ word: SKILL_STEP.BLOCKED, needs: NEEDS.PERSON, because: `${BLOCKS.APPROVAL_REQUIRED}: ${list.find((a) => a.state === "pending").id} waits for a person to allow ${s.id} once, in Orbit Control` }) },
  { when: (list) => list.at(-1)?.state === "rejected", then: (c, s) => ({ word: SKILL_STEP.BLOCKED, needs: NEEDS.PERSON, because: `${BLOCKS.APPROVAL_REJECTED}: a person refused ${s.id}` }) },
  { when: () => true, then: (c, s, list, gate) => requested(c, s, gate) },
];

function requested(c, s, gate) {
  const done = apply(c, "request-approval", { ...gate, reason: clip(`${stepRef(c, s.id)} of ${c.skill}: ${s.capability}`), risk: clip(`a read through ${gate.params.provider}, for a declared workflow`) });
  return { word: SKILL_STEP.BLOCKED, needs: NEEDS.PERSON, because: `${BLOCKS.APPROVAL_REQUIRED}: ${done.lines[0].id} asks a person to allow ${s.id} once, in Orbit Control` };
}

// A step that needs a person is let through only on a grant for exactly this action, checked now -- one that expired
// or was spent allows nothing, and a new request is made.
const approvedFor = (c, s, chosen, gate) => (chosen.asks ? ((list) => APPROVAL.find((row) => row.when(list)).then(c, s, list, gate))(approvalsFor(c, c.ports.task.fingerprint(gate))) : {});

// ---- one step: started, asked, judged ------------------------------------------------------------------

function startedNested(c, s, chosen, gate, approval) {
  try { return { act: actStarted(c, s, chosen, gate, approval) }; }
  catch (e) { return { word: SKILL_STEP.BLOCKED, needs: NEEDS.PERSON, because: clip(`${BLOCKS.BUDGET}: ${scrub(e.message)}`) }; }
}

function actStarted(c, s, chosen, gate, approval) {
  const line = apply(c, "act-start", { type: ACTION_TYPE.SKILL_STEP, tool: gate.tool, label: clip(`${stepRef(c, s.id)}: ${s.capability}`), mutates: false, ...(approval ? { approval, environment: gate.environment, params: gate.params } : {}) }).lines.find((l) => l.kind === "action-started");
  apply(c, "link-receipt", { domain: DOMAIN.SKILLSTEP, ref: stepRef(c, s.id), outcome: SKILL_STEP.RUNNING, action: line.id, providerKey: chosen.provider.key, summary: clip(`${s.capability} via ${chosen.provider.kind} ${chosen.provider.id}${s.tool ? ` · ${s.tool}` : ""}`) });
  return line.id;
}

const TIMED_OUT = (binding, s, ms) => ({ receipt: { provider: binding.provider.key, tool: s.tool ?? binding.provider.id, queryDigest: null, resultDigest: null, sourceRefs: [], outcome: "blocked", why: `no answer within ${ms} ms` }, answer: null, operation: null, timedOut: true });

// A call's answer, or -- when its wait is spent -- a blocked one. The call is never sent again for being slow.
const timed = (promise, binding, s) => ((ms) => new Promise((done) => {
  const timer = setTimeout(() => done(TIMED_OUT(binding, s, ms)), ms);
  timer.unref?.();
  promise.then((v) => (clearTimeout(timer), done(v)), (e) => (clearTimeout(timer), done({ receipt: { provider: binding.provider.key, tool: s.tool ?? binding.provider.id, outcome: "blocked", why: clip(scrub(e?.message ?? e)) }, answer: null, operation: null })));
}))(s.timeoutMs ?? DEFAULT_TIMEOUT_MS);

const invocationReceipt = (c, s, act, res) => ({ domain: DOMAIN.INVOCATION, ref: `${stepRef(c, s.id)}.${c.invocations}`, outcome: String(res.receipt.outcome).toUpperCase(), action: act, providerKey: res.receipt.provider, ...(res.receipt.queryDigest ? { queryDigest: res.receipt.queryDigest } : {}), ...(res.receipt.resultDigest ? { resultDigest: res.receipt.resultDigest } : {}), ...(res.operation ? { operation: res.operation } : {}), summary: clip(res.receipt.why ?? `${res.receipt.tool} answered${res.receipt.sourceRefs?.length ? `, naming ${res.receipt.sourceRefs.length} source(s)` : ""}`) });

async function oneCall(c, s, chosen, input, act) {
  c.calls += 1;
  c.invocations += 1;
  const res = await timed(c.ports.invoke.call(chosen.binding, { capability: s.capability, tool: s.tool, input, workflow: CALLED_UNDER, readOnly: true }), chosen.binding, s);
  apply(c, "link-receipt", invocationReceipt(c, s, act, res));
  return res;
}

// Asked again only after an error or a spent wait of a call that read, within the step's retries and the bounds.
const retryable = (res) => res === null || (["error", "blocked"].includes(res.receipt.outcome) && res.operation !== "write");

async function asking(c, s, chosen, input, act) {
  let res = null;
  for (let n = 0; n <= (s.retries ?? 0) && retryable(res) && !spent(c); n += 1) res = await oneCall(c, s, chosen, input, act);
  return res;
}

// ---- one step: what the answer proves -----------------------------------------------------------------

const recordOf = (s, values) => Object.entries(s.outputs ?? {}).filter(([, o]) => o.type === "record").map(([n]) => values[n]).find(Boolean) ?? null;

const READ_WORD = { satisfied: SKILL_STEP.VERIFIED, violated: SKILL_STEP.VERIFY_FAILED };

// An owner-record step is VERIFIED only when the record it names, read back from its owner, proves it -- one this
// workflow cannot read back leaves the step as reported as a met contract, never verified.
function provedBy(c, s, values, act) {
  const ref = recordOf(s, values);
  const [domain, ...rest] = String(ref).split(":");
  const read = Object.hasOwn(READ_BACK, domain) ? quietly(() => READ_BACK[domain](c.ports, rest.join(":"), c.lw)) : null;
  return READ_WORD[read?.verdict] ? linkedProof(c, s, read, act) : { word: SKILL_STEP.CONTRACT_MET, because: `its contract held; ${ref} could not be read back here (${read?.because ?? "no such owner"}) — reported, not proven` };
}

function linkedProof(c, s, read, act) {
  apply(c, "link-receipt", { ...read.receipt, action: act });
  apply(c, "link-verification", { subject: `${DOMAIN.SKILLSTEP}:${stepRef(c, s.id)}`, obligation: clip(`${s.id} names a record its owner proves`), evidence: `${read.receipt.domain}:${read.receipt.ref}`, state: read.verdict });
  return { word: READ_WORD[read.verdict], because: clip(`${read.receipt.domain}:${read.receipt.ref} ${read.receipt.outcome}${read.because ? ` — ${read.because}` : ""}`) };
}

function contracted(c, s, res, act) {
  const out = c.ip.outputsOf(s, res.answer);
  const contract = c.ip.contractOf(s, out);
  if (!contract.met) return { word: SKILL_STEP.VERIFY_FAILED, because: clip(`its output contract did not hold: ${[...contract.missing.map((m) => `${m} missing`), ...contract.failed].join("; ")}`) };
  c.scope.outputs.set(s.id, out.values);
  return s.evidence === "owner-record" ? provedBy(c, s, out.values, act) : { word: SKILL_STEP.CONTRACT_MET, because: "answered, and its output contract held — reported, not proven" };
}

const ANSWERED = [
  { when: (res) => res === null, then: () => ({ word: SKILL_STEP.BLOCKED, needs: NEEDS.PERSON, because: `${BLOCKS.BUDGET}: the workflow's bounds were spent before it was asked` }) },
  { when: (res) => res.timedOut, then: (c, s, res) => ({ word: SKILL_STEP.BLOCKED, needs: NEEDS.ENVIRONMENT, because: `${BLOCKS.TIMEOUT}: ${res.receipt.why}` }) },
  { when: (res) => res.receipt.outcome === "refused", then: (c, s, res) => ({ word: SKILL_STEP.REFUSED, because: clip(res.receipt.why) }) },
  { when: (res) => res.receipt.outcome === "blocked", then: (c, s, res) => ({ word: SKILL_STEP.BLOCKED, needs: NEEDS.ENVIRONMENT, because: clip(`${BLOCKS.TOOL_UNAVAILABLE}: ${res.receipt.why}`) }) },
  { when: (res) => res.receipt.outcome !== "ok", then: (c, s, res) => ({ word: SKILL_STEP.FAILED, because: clip(res.receipt.why ?? "the call failed") }) },
  { when: () => true, then: (c, s, res, act) => contracted(c, s, res, act) },
];

const optionalOf = (s, j) => (required(s) || stepWord(j.word).done ? j : { ...j, because: clip(`optional — ${j.because ?? j.word}`) });

async function called(c, s, chosen, input) {
  const gate = gateOf(c, s, chosen, input);
  const allowed = approvedFor(c, s, chosen, gate);
  if (allowed.word) return settledWithout(c, s, allowed);
  return startedAndAsked(c, s, chosen, input, gate, allowed.approval);
}

async function startedAndAsked(c, s, chosen, input, gate, approval) {
  const nested = startedNested(c, s, chosen, gate, approval);
  if (nested.word) return settledWithout(c, s, nested);
  const res = await asking(c, s, chosen, input, nested.act);
  return settledWith(c, s, optionalOf(s, ANSWERED.find((row) => row.when(res)).then(c, s, res, nested.act)), nested.act);
}

async function invoked(c, s) {
  const input = c.ip.inputFor(s, c.scope);
  if (!input.ok) return settledWithout(c, s, contextMissing(c, s, input) ? { word: SKILL_STEP.BLOCKED, needs: NEEDS.PERSON, because: `${BLOCKS.INPUT_MISSING}: ${input.missing.join(", ")} has no value in this workflow` } : { word: SKILL_STEP.SKIPPED, because: `what it reads was not answered: ${input.missing.join(", ")}` });
  const chosen = chosenFor(c, s);
  return chosen.word ? settledWithout(c, s, chosen) : called(c, s, chosen, input.input);
}

async function carried(c, id) {
  const s = c.ip.stepOf(c.wf, id);
  const row = BEFORE.find((b) => b.when(c, s));
  return row ? row.then(c, s) : invoked(c, s);
}

// ---- the run, settled from its steps -------------------------------------------------------------------

const requiredIds = (c) => c.order.filter((id) => required(c.ip.stepOf(c.wf, id)));

const RUN = [
  { when: (c) => c.stop && stepWord(c.stop.word).waits, word: RUN_WORD.BLOCKED, read: (c) => blockedRead(c.stop.needs, `${c.stop.step}: ${c.stop.because}`) },
  { when: (c) => c.stop !== null, word: RUN_WORD.FAILED, read: (c) => ({ verdict: "violated", receipt: null, because: clip(`${c.stop.step}: ${c.stop.because}`) }) },
  { when: (c) => requiredIds(c).length > 0 && requiredIds(c).every((id) => wordOf(c, id) === SKILL_STEP.VERIFIED), word: RUN_WORD.VERIFIED, read: (c, r) => ({ verdict: "satisfied", receipt: r }) },
  { when: () => true, word: RUN_WORD.REPORTED, read: (c, r) => ({ verdict: "reported", receipt: null, summary: r.summary }) },
];

const runSummary = (c) => clip(`${c.pin} · ${c.order.map((id) => `${id} ${wordOf(c, id) ?? "PENDING"}`).join(", ")}`);

// The run's receipt is written here -- except a VERIFIED one, which the step's settling links as its evidence.
function settledRun(c) {
  const row = RUN.find((r) => r.when(c));
  const receipt = { domain: DOMAIN.SKILLRUN, ref: c.run, outcome: row.word, pin: c.pin, summary: runSummary(c) };
  if (row.word !== RUN_WORD.VERIFIED) apply(c, "link-receipt", { ...receipt, action: c.act });
  return { ...row.read(c, receipt), summary: receipt.summary };
}

// The engine step itself (dispatch.mjs ENGINE): a playbook step whose provider declares its workflow.
export async function skillRun(ports, lw, step, dispatch) {
  const got = prepared(ports, lw, step, dispatch.provider);
  if (got.read) return got.read;
  for (const id of got.c.order) await carried(got.c, id);
  return settledRun(got.c);
}

// ---- what reconcile closes (loop.mjs) -------------------------------------------------------------------

// A step whose run is gone: INTERRUPTED when it read (the next attempt asks again), AMBIGUOUS when it may have changed
// something (never asked again; a person decides) -- closed, and never run again by itself.
export function interruptedStepOps(view, act) {
  const r = view.receipts.find((x) => x.domain === DOMAIN.SKILLSTEP && x.action === act.id);
  const word = act.mutates === false ? SKILL_STEP.INTERRUPTED : SKILL_STEP.AMBIGUOUS;
  return [...(r ? [["link-receipt", { domain: DOMAIN.SKILLSTEP, ref: r.ref, outcome: word, action: act.id, summary: clip(stepWord(word).say) }]] : []), ["act-fail", { action: act.id, reason: clip(`what ran it is gone — ${stepWord(word).say}`) }]];
}

// The run a playbook step's engine action was carrying, when that action is closed as interrupted.
export const interruptedRunOps = (view, act) => receiptsIn(view, DOMAIN.SKILLRUN).filter((r) => r.action === act.id && r.outcome === RUN_WORD.RUNNING).map((r) => ["link-receipt", { domain: DOMAIN.SKILLRUN, ref: r.ref, outcome: RUN_WORD.INTERRUPTED, pin: r.pin, action: act.id, summary: clip(`interrupted — ${r.summary ?? r.pin}`) }]);
