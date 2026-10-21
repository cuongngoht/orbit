// `call`: ask a registered capability, and rule on the answer.
//
// This is THE extension point, and the reason there is no `postgres` verb, no
// `redis` verb and no `msgraph` verb. A verb is grammar: the set of them shapes
// every case, every report column and every coverage denominator, so it has
// stayed at thirteen through five releases because growing it is expensive. A
// provider is not grammar, it is a thing you can ask. Providers grow; the grammar
// does not.
//
// Which LAYER the verdict rules on is on the step, not on this row, because the
// same capability can be either -- asking a vendor's API right after a click is
// news about the call the screen made; asking it cold is news about the data
// underneath. dsl/core/verbs.mjs says why, and `proves` is enum-constrained to
// the three, so this cannot invent a fourth.
import { invokeNow } from "../../capability/invoke.mjs";
import { interpolate, placeholders } from "../../dsl/interpolate.mjs";
import { oneValue } from "../capture.mjs";
import { StepError, trunc } from "../errors.mjs";
import { verdict } from "../verdict.mjs";

export default {
  name: "call",
  label: (s) => `${s.capability}${s.select ? ` → ${s.select}` : ""}`,
  act(ctx, run, s) {
    const value = invokeNow(ctx, run, { ...s, input: filled(ctx, run, s) });
    verdict(s, value);
    return value;
  },
  tail: (s, r) => trunc(JSON.stringify(r.result), 60),
  logged: (r) => ({ result: r.result }),
  capture: (step, result) => oneValue(step, selected(step, result)),
};

// `input` is the one field the ENGINE does not interpolate (its row says
// literal), and this is why: the engine does not know which language each key is
// read as, and the capability does. `postgres.query`'s `query` key declares
// esc: "sql"; a key holding an id declares nothing and travels as text. Filling
// it here, with the capability in hand, is the only place both facts exist.
function filled(ctx, run, s) {
  const cap = ctx.capabilities.resolve(s.capability);
  const out = walk(s.input ?? {}, (v, key) => interpolate(v, run.values ?? {}, cap.inputSchema?.[key]?.esc ?? "text"));
  refuseUnfilled(s, out);
  return out;
}

// Every string leaf, however deep, so a placeholder nested in an array of
// filters is filled and -- more importantly -- CANNOT hide from the check below.
function walk(value, fill, key = null) {
  if (typeof value === "string") return fill(value, key);
  if (Array.isArray(value)) return value.map((v) => walk(v, fill, key));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, walk(v, fill, k)]));
  return value;
}

// The same defence run/step.mjs applies to every other field, applied here
// because `input` opted out of its check by opting out of its interpolation. A
// step still carrying ${X} asks a different question and gets an answer that
// looks like a result.
function refuseUnfilled(s, input) {
  const names = [...new Set(placeholders(JSON.stringify(input)))];
  if (!names.length) return;
  throw Object.assign(new StepError(`${s.capability}: unresolved placeholder(s) ${names.map((n) => `\${${n}}`).join(", ")} in input — not a param, and no resolve filled it`), { phase: "bind" });
}

// WHICH part of the answer `into` binds.
//
// A DOT PATH, and deliberately not a JS expression. `expect` is already an
// expression and is already evaluated -- adding a second one would mean a case
// could compute a binding, and a binding that was computed is a value nobody can
// trace back to something the capability actually said. A path can only ever
// point AT the answer. `rows.0.id` reaches into an array; a missing step in the
// path is a failure with the path in it, not a quiet undefined three steps later.
function selected(step, result) {
  if (!step.select) return result;
  return step.select.split(".").reduce((at, key) => reached(step, at, key), result);
}

function reached(step, at, key) {
  if (at === null || at === undefined) throw new StepError(`into ${step.into}: select "${step.select}" ran out at "${key}" — the capability's answer has no such path`);
  return at[key];
}
