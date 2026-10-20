// What a work NEEDS, proposed by the host and judged before anything is kept.
//
// A need says what has to be found out, proved or done, as a sentence and a subject -- and, for
// what is found out or proved, the CAPABILITY that could serve it: a word such as
// documentation.search, never a server, a tool or a URL. Which provider serves it today is a
// binding, written when the work resolves. So a need survives a server being switched off, and
// a project's own adapter arriving later changes who serves it, not what it asks.
//
// It may depend on requirement FACTS the work's adopted snapshot lists, and on needs proposed
// before it, so the graph has no forward edge and no cycle. It may name the project files it
// is about (its scope), so that a change to those files is noticed. A batch is all or nothing.
import { CAPABILITY_ID } from "../capability/contract-v1.mjs";
import { constraintFindings, missingFindings } from "../constraints.mjs";
import { scrub } from "../scrub.mjs";
import { needId } from "./model.mjs";
import { NEED_TYPE_NAMES, needsCapability } from "./vocab.mjs";

export const SLUG = "^[a-z0-9][a-z0-9._-]{0,63}$";
export const FACT_REF = /^rf-[0-9a-f]{12}$/;
export const NEED_REF = /^nd-[0-9a-f]{10}$/;
export const MAX_NEEDS = 64;
export const MAX_DEPENDS = 8;
export const MAX_SCOPE = 8;
export const MAX_ASKS = 240;

export const NEED_FIELDS = {
  type: { type: "string", enum: NEED_TYPE_NAMES, doc: "What kind of need it is: something to prove, to find out, or to do." },
  subject: { type: "string", pattern: SLUG, doc: "What it is about, as a plain slug." },
  capability: { type: "string", pattern: CAPABILITY_ID.source, doc: "The capability that could serve it, as a word like documentation.search. Never a server, a tool or a URL." },
  asks: { type: "string", doc: "What has to be found out, proved or done, in one sentence." },
  dependsOn: { type: "array", items: { type: "string" }, doc: "The requirement facts (rf-…) and the earlier needs (nd-…) it waits on." },
  scope: { type: "array", items: { type: "string" }, doc: "The project files it is about, by relative path." },
  because: { type: "string", doc: "Why it is needed, briefly." },
};

export const NEED_REQUIRED = ["type", "subject", "asks"];

const isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);

const list = (v) => (Array.isArray(v) ? v : []);

// A path inside the project: relative, no way out of it, nothing that names another place.
export const safePath = (p) => typeof p === "string" && p.length > 0 && p.length <= 200 && !p.startsWith("/") && !/^[A-Za-z]:|[\\\0:*?"<>|]/.test(p) && !p.split("/").includes("..");

export const SPECS = [
  { name: "asks", when: (n) => typeof n.asks !== "string" || !n.asks.trim() || n.asks.length > MAX_ASKS, say: () => `a need asks something, in one sentence of at most ${MAX_ASKS} characters` },
  { name: "capability", when: (n) => needsCapability(n.type) && !n.capability, say: (n) => `a ${n.type} need names the capability that could serve it — a word like documentation.search, never a server or a tool` },
  { name: "secret", when: (n) => [n.subject, n.capability].some((v) => typeof v === "string" && scrub(v) !== v), say: () => "a subject or a capability that looks like a secret is refused, never masked" },
  { name: "depends", when: (n) => list(n.dependsOn).some((d) => !FACT_REF.test(d) && !NEED_REF.test(d)), say: () => "dependsOn names requirement facts by their rf- ids and earlier needs by their nd- ids" },
  { name: "scope", when: (n) => list(n.scope).some((p) => !safePath(p)), say: () => "scope names files inside the project by relative path — nothing absolute, nothing that leaves it" },
  { name: "bounds", when: (n) => list(n.dependsOn).length > MAX_DEPENDS || list(n.scope).length > MAX_SCOPE, say: () => `at most ${MAX_DEPENDS} dependencies and ${MAX_SCOPE} paths — more is several needs` },
];

// What the work stands on, for the two kinds of dependency: which facts its adopted snapshot
// lists (null when none is adopted) and which needs came before.
export const worldFindings = (n, at, world) => list(n.dependsOn).flatMap((d) => dependencyWhy(d, at, world));

function dependencyWhy(d, at, world) {
  if (FACT_REF.test(d)) return world.facts?.has(d) ? [] : [`${at}: ${d} is not a fact of the snapshot this work adopted${world.facts ? "" : " (it has adopted none)"}`];
  return NEED_REF.test(d) && !world.needs.has(d) ? [`${at}: ${d} is not a need proposed before this one`] : [];
}

export function needFindings(raw, where, world) {
  if (!isObject(raw)) return [`${where}: must be a JSON object`];
  const unknown = Object.keys(raw).filter((k) => !(k in NEED_FIELDS)).map((k) => `${where}: unknown field "${k}"`);
  const shape = [...unknown, ...missingFindings(NEED_REQUIRED, raw, where), ...constraintFindings(NEED_FIELDS, raw, where)];
  if (shape.length) return shape;
  return [...SPECS.filter((s) => s.when(raw)).map((s) => `${where}: ${s.say(raw)}`), ...worldFindings(raw, where, world)];
}

// The need as the journal keeps it. Its id is what it is, so the same need twice is one.
export const needOf = (work, raw) => ({ id: needId(work, raw.type, raw.capability ?? null, raw.subject), type: raw.type, subject: raw.subject, ...(raw.capability ? { capability: raw.capability } : {}), asks: raw.asks.trim(), dependsOn: [...new Set(list(raw.dependsOn))].sort(), scope: [...new Set(list(raw.scope))], ...(raw.because ? { because: raw.because } : {}) });

// One row at a time, each seeing the needs before it: a dependency may only point backwards.
export function judgeNeeds(work, rows, world) {
  const known = new Set(world.needs);
  const results = rows.map((raw, i) => {
    const why = needFindings(raw, `need ${i + 1}`, { ...world, needs: known });
    const need = why.length ? null : needOf(work, raw);
    if (need) known.add(need.id);
    return { need, why };
  });
  const rejected = results.flatMap((r) => r.why);
  return { accepted: rejected.length ? [] : results.map((r) => r.need), rejected };
}
