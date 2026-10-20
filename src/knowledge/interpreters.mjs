// Extension INTERPRETERS -- code a project registered that understands a
// relation the kernel only stores.
//
// An interpreter declares the relations it `understands`
// (src/extensions/knowledge-v1.mjs) and is handed exactly those claims, as
// FROZEN copies -- never the store, never the rest -- to say what they imply:
//
//   needs   capabilities that would prove something those claims describe,
//           each citing the claims it rests on (`because`, a subset of what it
//           was handed) -- they flow into the same resolver every other need
//           does, and never select a provider themselves
//   notes   a line or two for the person reading, scrubbed and quoted
//
// It is extension code inside the pipeline, so it runs GUARDED, the way a
// validator does: one that throws reports its own defect and costs only its
// own answer, and anything it returns that does not hold to the contract is
// dropped with a reason rather than trusted.
import { CAPABILITY_ID } from "../capability/contract-v1.mjs";
import { quote } from "../quote.mjs";
import { scrub } from "../scrub.mjs";
import { merged } from "./applies.mjs";
import { isObject } from "./model.mjs";
import { weaker } from "./vocab.mjs";

export const MAX_INTERPRETED_NEEDS = 12;
export const MAX_NOTES = 8;

// `info`: claim id → its graded row ({ tier, grade }), so a need an interpreter
// derives is only as strong as the weakest claim it cites.
export function interpreted(parts, claims, ask, info) {
  const results = parts.interpreters().map((i) => guarded(i, claims.filter((c) => i.understands.includes(c.relation)), ask, info));
  return { needs: results.flatMap((r) => r.needs).slice(0, MAX_INTERPRETED_NEEDS), notes: results.flatMap((r) => r.notes).slice(0, MAX_NOTES), problems: results.flatMap((r) => r.problems), understood: results.filter((r) => r.handed).map((r) => r.id) };
}

function guarded(interpreter, handed, ask, info) {
  if (!handed.length) return { id: interpreter.id, handed: 0, needs: [], notes: [], problems: [] };
  try { return { id: interpreter.id, handed: handed.length, ...checked(interpreter, interpreter.interpret({ claims: frozen(handed), context: Object.freeze({ ...(ask.context ?? {}) }) }), handed, info) }; }
  catch (e) { return { id: interpreter.id, handed: handed.length, needs: [], notes: [], problems: [`${interpreter.id} (${interpreter.from}) threw — ${quote(scrub(String(e?.message ?? e)), 160)}. That is the extension's own defect; nothing it would have said was used`] }; }
}

const frozen = (claims) => Object.freeze(claims.map((c) => Object.freeze({ ...c, context: Object.freeze({ ...c.context }), evidence: Object.freeze([...(c.evidence ?? [])]) })));

function checked(interpreter, out, handed, info) {
  const given = new Set(handed.map((c) => c.id));
  const judged = (Array.isArray(out?.needs) ? out.needs : []).map((n) => needOf(interpreter, n, { given, handed, info }));
  const notes = (Array.isArray(out?.notes) ? out.notes : []).slice(0, MAX_NOTES).map((n) => `${interpreter.id}: ${quote(scrub(String(n)), 200)}`);
  return { needs: judged.filter((j) => j.need).map((j) => j.need), notes, problems: judged.filter((j) => j.why).map((j) => j.why) };
}

const CAPABILITY = new RegExp(CAPABILITY_ID.source.toLowerCase());

function needOf(interpreter, raw, world) {
  const capability = String(raw?.capability ?? "").toLowerCase();
  const because = Array.isArray(raw?.because) ? raw.because : [];
  const wrong = [...(CAPABILITY.test(capability) ? [] : [`a need for "${raw?.capability}", which is not a capability id`]), ...(because.length && because.every((id) => world.given.has(id)) ? [] : ["a need must cite (because) only claims it was handed"])];
  if (wrong.length) return { why: `${interpreter.id}: ${wrong.join("; ")} — dropped` };
  return { need: shapedNeed(interpreter, raw, capability, because, world) };
}

function shapedNeed(interpreter, raw, capability, because, world) {
  const cited = world.handed.filter((c) => because.includes(c.id));
  const context = cited.reduce((ctx, c) => (ctx ? merged(ctx, c.context) : null), {});
  const tier = cited.map((c) => world.info.get(c.id)?.tier ?? "inference").reduce(weaker, "rule");
  return { capability, proves: provesOf(raw?.proves, cited[0]), context: context ?? {}, conditional: cited.some((c) => world.info.get(c.id)?.grade === "conditional"), tier, because, session: cited.some((c) => c.layer === "session"), by: interpreter.id };
}

const SLOTS = ["subject", "consequence", "implementation", "observation"];

const provesOf = (raw, first) => Object.fromEntries(SLOTS.map((k) => [k, isObject(raw) && typeof raw[k] === "string" ? raw[k] : k === "subject" ? first?.subject ?? null : null]).filter(([, v]) => v !== null));
