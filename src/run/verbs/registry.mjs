// The executor REGISTRY: one Strategy per verb, looked up by name.
//
// The runner knows `resolve(name).act(ctx, run, step)` and nothing else about
// what any particular verb is. That was already true; what was not is WHERE the
// set comes from. It used to be a static import list in this directory, so the
// only way a project could add a behaviour was to edit the installed plugin --
// and the next upgrade overwrote it.
//
// So a registration is checked AT REGISTRATION, against the vocabulary the same
// composition root built:
//
//   * a behaviour with no verb row is a step nothing could ever validate;
//   * a verb row with no behaviour is a case that passes `check` and then dies
//     at step 14 of a live run;
//   * a row that offers `into` and a behaviour that cannot capture() is a case
//     declaring a binding the runner has no way to make.
//
// Two of those used to be one assertion at import time. Doing it per
// registration is what lets the same rule hold an EXTENSION to the contract a
// second before it would otherwise have been trusted, and lets the message name
// who registered the thing.
import { Refused } from "../../errors.mjs";

export function createExecutorRegistry(dsl) {
  const impls = new Map();
  return {
    register: (impl, from) => add(impls, dsl, impl, from),
    resolve: (name) => resolved(impls, name),
    has: (name) => impls.has(name),
    list: () => [...impls.values()],
    names: () => [...impls.keys()],
    sourceOf: (name) => impls.get(name)?.from ?? null,
  };
}

function add(impls, dsl, impl, from) {
  const bad = problems(impls, dsl, impl, from);
  if (bad.length) throw new Refused(`${from ?? "this caller"}: cannot register an executor — ${bad.join("; ")}`);
  impls.set(impl.name, { ...impl, from: from ?? "core" });
}

function problems(impls, dsl, impl, from) {
  if (!isObject(impl) || typeof impl.name !== "string") return ["an executor is an object with a name"];
  const at = `executor "${impl.name}"`;
  if (typeof impl.act !== "function") return [`${at}: has no act(ctx, run, step)`];
  return [...takenProblem(impls, impl.name, at), ...vocabularyProblems(dsl, impl, at)];
}

function takenProblem(impls, name, at) {
  const owner = impls.get(name)?.from;
  return owner ? [`${at}: already registered by ${owner}`] : [];
}

// Held to the VOCABULARY, not to a second list. A behaviour whose verb nobody
// declared can never be reached -- the validator refuses the step first -- so
// registering it is a mistake worth saying out loud rather than dead weight.
function vocabularyProblems(dsl, impl, at) {
  const verb = dsl.verb(impl.name);
  if (!verb) return [`${at}: no verb row declares it — add one before the behaviour, or the step could never validate`];
  return capturePromise(verb, impl, at);
}

const capturePromise = (verb, impl, at) =>
  (verb.fields.includes("into") && typeof impl.capture !== "function"
    ? [`${at}: its verb offers "into" but it has no capture() — a case could declare a binding nothing can make`]
    : []);

// Refused, not undefined. A step whose verb has no behaviour is a run that was
// never going to happen, and finding that out as a TypeError on `.act` costs
// whoever reads the stack the ten minutes this sentence saves.
function resolved(impls, name) {
  const impl = impls.get(name);
  if (!impl) throw new Refused(`no behaviour is registered for "${name}" — the vocabulary knows the verb but nothing can run it`);
  return impl;
}

// The other direction, asked ONCE by the composition root after everything --
// core and every extension -- has registered. It cannot be asked per
// registration: while extensions are still loading, a verb with no behaviour yet
// is normal.
export function agree(dsl, registry) {
  const owed = dsl.verbNames().filter((n) => !registry.has(n));
  if (owed.length) throw new Refused(`verb registry drift — ${owed.join(", ")} ${owed.length > 1 ? "are verbs" : "is a verb"} nothing can run`);
  return registry;
}

const isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
