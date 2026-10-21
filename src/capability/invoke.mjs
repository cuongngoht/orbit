// Every capability invocation goes through here, and there is no second route.
//
// That is the whole point of the file. A generated QC script that spawned `psql`
// itself would be a second execution pipeline: no input check, no mutation
// guard, no tool check, no typed outcome, nothing in the log and nothing in the
// evidence. It would also be the place where "the tool crashed" starts getting
// reported as "the product is wrong", which is the one mistake this engine is
// least willing to make.
//
// The gates are an ordered TABLE, not a chain of ifs, for the reason
// constraints.mjs gives: a table reads as the list it is, and a new concern is a
// row. The order is the order a reader should be told:
//
//   input     the case asked for something the capability cannot accept
//   binding   a logical ref it binds cannot be resolved for this run (ADR 0036)
//   mutation  it can change the world and the case never said it would
//   tools     the command it needs is not usable on this machine
//   connection the connection it needs (a credential reference a person set up)
//             does not exist here
//
// and only then is anything invoked.
//
// WHICH TYPED STOP each one earns is the interesting decision, and they are not
// the same. A malformed input is the CASE being wrong -- bad usage, an obvious
// fix, REFUSED. A missing `psql` is a precondition nobody could establish, which
// is exactly what the database port already says about a database behind a VPN:
// BLOCKED. The product is not broken because this laptop lacks a client, and
// filing it as a failure is how a team learns to stop believing red.
import { constraintFindings, missingFindings } from "../constraints.mjs";
import { Blocked, Refused, StepError } from "../errors.mjs";
import { extensionContextV1 } from "../extensions/context-v1.mjs";
import { scrubbed } from "../scrub.mjs";

const GATES = [
  { name: "input", ask: inputProblem },
  { name: "binding", ask: bindingProblem },
  { name: "mutation", ask: mutationProblem },
  { name: "tools", ask: toolProblem },
  { name: "connection", ask: connectionProblem },
];

// `invocation` is what the gates learn on the way -- the values the binding gate resolved, the
// secrets an identity needs in a helper's environment -- handed to the capability's facade and
// never to the capability itself.
export function invokeCapability(ctx, run, step) {
  const cap = ctx.capabilities.resolve(step.capability);
  const input = step.input ?? {};
  const invocation = { bound: {}, env: {} };
  for (const gate of GATES) stop(gate.ask(ctx, run, cap, input, invocation));
  return answered(ctx, run, cap, input, invocation);
}

function stop(problem) {
  if (!problem) return;
  throw problem.blocked ? new Blocked(problem.message) : new Refused(problem.message);
}

// Held to the capability's OWN declared schema, by the same enforcer a case field
// goes through. A capability that declares no inputSchema is taken at its word
// and asked nothing -- silence is not a licence to invent a rule it never stated.
function inputProblem(ctx, run, cap, input) {
  if (!cap.inputSchema) return null;
  const at = `${cap.id} input`;
  const wrong = [...missingFindings(cap.required ?? [], input, at), ...unknown(cap, input, at), ...constraintFindings(cap.inputSchema, input, at)];
  return wrong.length ? { message: `${cap.id} was asked for something it cannot accept:\n  ${wrong.join("\n  ")}` } : null;
}

const unknown = (cap, input, at) => Object.keys(input).filter((k) => !(k in cap.inputSchema)).map((k) => `${at}: unknown key "${k}" — it accepts ${Object.keys(cap.inputSchema).join(", ")}`);

// A row that says `bind: <kind>` names a LOGICAL ref -- an endpoint, an identity, a channel --
// which this run's binder resolves to what the task's sandbox actually holds. The capability is
// never told an address or a credential: the resolved values go to its helper in `bound`, a
// secret only into the helper's environment. Blocked when nothing binds here: an unbound ref is
// a precondition nobody established, never the product being wrong.
function bindingProblem(ctx, run, cap, input, invocation) {
  const rows = Object.entries(cap.inputSchema ?? {}).filter(([k, row]) => row?.bind && input[k] !== undefined);
  if (!rows.length) return null;
  if (typeof ctx.binder?.resolve !== "function") return { blocked: true, message: `${cap.id} binds ${rows.map(([k, row]) => `${k} (${row.bind})`).join(", ")}, and nothing binds them here — a task's sandbox does; nothing about the product was observed` };
  const problems = rows.map(([k, row]) => boundInto(ctx, run, cap, invocation, k, row.bind, input[k])).filter(Boolean);
  return problems.length ? { blocked: problems.some((p) => p.blocked), message: problems.map((p) => p.message).join("\n  ") } : null;
}

function boundInto(ctx, run, cap, invocation, key, kind, ref) {
  const r = ctx.binder.resolve(kind, ref, { run, cap });
  if (!r?.ok) return { blocked: r?.blocked !== false, message: `${cap.id}: ${key} "${ref}" could not be bound as ${kind} — ${r?.why ?? "the binder had no answer"}` };
  invocation.bound[key] = r.value;
  Object.assign(invocation.env, r.env ?? {});
}

// The guard a destructive case already has, reused rather than reinvented. A
// capability that says it mutates may only be reached from a case that said so
// too -- and the destructive gate is then what demands --force-destructive, so
// there is still exactly one place that decides whether a run may change things.
function mutationProblem(ctx, run, cap) {
  if (!cap.mutates || run?.c?.destructive) return null;
  return { message: `${cap.id} declares that it can change external state, and this case does not declare "destructive": true — a case that writes has to say so, and then --force-destructive is what allows it` };
}

// Blocked, deliberately. See the header: the product is not broken because this
// machine has no psql. `query doctor` is what says it BEFORE a run, and this is
// what says it honestly when nobody asked doctor first.
function toolProblem(ctx, run, cap) {
  const missing = (cap.tools ?? []).map((bin) => [bin, ctx.tools.present(bin)]).filter(([, state]) => !state.ok);
  if (!missing.length) return null;
  return { blocked: true, message: `${cap.id} needs ${missing.map(([bin, s]) => `${bin} (${s.why})`).join(", ")} — nothing was asked of the product, so nothing about it was proved wrong. \`query doctor\` reports this before a run does.` };
}

// Blocked, for the same reason a missing command is: nobody set up the connection
// on this machine, and the product is not wrong because of it. `ctx.connections`
// is bound by a composition root; where none is, a capability that names a
// connection cannot be reached at all, which is the honest answer. The credential
// itself never passes through here -- the engine hands it to the command the
// capability spawns (src/extensions/context-v1.mjs), and to nothing else.
function connectionProblem(ctx, run, cap) {
  if (!cap.connection || ctx.connections?.has?.(cap.connection)) return null;
  return { blocked: true, message: `${cap.id} needs a connection for ${cap.connection}, and none is set up here — nothing was asked of the product, so nothing about it was proved wrong. Add one in Orbit Control (Connections); a person enters the credential once, and it is never kept in this project.` };
}

// What the log keeps is scrubbed by shape (src/scrub.mjs): a capability's answer is the one
// value in run-log.jsonl that came from outside the engine, and a token echoed in a response body
// must never reach the ledger, a lesson or a report. The value a verdict judges is the answer as
// given.
function answered(ctx, run, cap, input, invocation) {
  const value = called(cap, extensionContextV1(ctx, run, cap, invocation), input);
  run?.log?.record({ kind: "capability", id: cap.id, by: cap.from, mutates: Boolean(cap.mutates), result: scrubbed(value) });
  return value;
}

// A capability that throws something the engine does not recognise is the TOOL
// failing. Filing that as a product defect is how a generated script's own bug
// gets shipped as a bug report against somebody's feature.
function called(cap, ext, input) {
  try { return settled(cap, cap.invoke(ext, input)); }
  catch (e) { throw typed(cap, e); }
}

// A promise is not an answer. Judged, it reads as `{}` and `Boolean(it)` passes -- the one false
// PASS this pipeline could produce. So it is refused as the tool's failure, and its rejection, if
// one ever comes, is swallowed rather than allowed to crash the run later.
function settled(cap, value) {
  if (!value || typeof value.then !== "function") return value;
  value.then(undefined, () => {});
  throw new Blocked(`${cap.id} answered with a promise — a capability answers synchronously, and an unsettled answer would be judged as {}. That is the tool failing, not the product: nothing about the product was observed. Reach an asynchronous SDK through a helper (ext.helper.run).`);
}

const typed = (cap, e) =>
  (e instanceof StepError || e instanceof Refused || e instanceof Blocked
    ? e
    : new Blocked(`${cap.id} could not be asked — ${e?.message ?? e}. That is the tool failing, not the product: nothing about the product was observed.`));
