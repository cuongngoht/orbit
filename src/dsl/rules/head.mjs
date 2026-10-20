// Rules about the case as a whole.
//
// The type/enum/pattern/required checks are NOT written here: they are declared
// once in fields.mjs (ROOT_FIELDS, ROOT_REQUIRED, PARAM_FIELDS) and enforced by
// constraints.mjs. What is left in this file is the handful of rules a shape
// cannot express -- the ones that compare two fields, or the file name.
import { basename } from "node:path";
import { constraintFindings, missingFindings } from "../../constraints.mjs";
import { PARAM_FIELDS, ROOT_FIELDS, ROOT_REQUIRED } from "../fields.mjs";
import { CORE } from "../registry.mjs";
import { unknownFields } from "./common.mjs";

const ROOT_KEYS = new Set([...Object.keys(ROOT_FIELDS), "_file", "_broken"]);
const PARAM_KEYS = new Set(Object.keys(PARAM_FIELDS));

export function headFindings(c, graph, dsl = CORE) {
  const declared = [...missingFindings(ROOT_REQUIRED, c, c.id), ...constraintFindings(ROOT_FIELDS, c, c.id)];
  const own = [...identityOf(c), ...seenOf(c), ...startOf(c, graph), ...paramFindings(c), ...createsOf(c, dsl), ...destructiveOf(c, graph)];
  return [...unknownFields(c, ROOT_KEYS, c.id), ...declared, ...own];
}

// The subject of this rule is a case FILE under screens/<screen>/cases/: two cases whose ids do
// not match their names are two cases nobody can find by either. A case read
// out of a report is not one of those -- the report is named after the RUN,
// and holding the case to that name would refuse every re-run from a report.
function identityOf(c) {
  if (!c._file || !c._file.endsWith(".json")) return [];
  const file = basename(c._file, ".json");
  return c.id === file ? [] : [`${c.id}: id does not match its file name (${file}.json)`];
}

// `live` is a claim about a browser run, and a claim with no commit cannot
// expire. The live|src enum itself is ROOT_FIELDS' job.
const seenOf = (c) => (c.seen === "live" && !c.fe_commit ? [`${c.id}: claims seen=live but records no fe_commit`] : []);

const startOf = (c, graph) => (c.start && !graph.screens.has(c.start) ? [`${c.id}: starts on unknown screen ${c.start}`] : []);

// A param nobody validated was a param that silently did not exist: `n` is the
// name a ${PLACEHOLDER} resolves through, so a lowercase one binds nothing.
const paramFindings = (c) => (c.params ?? []).flatMap((p, i) => oneParam(p, `${c.id} param ${i + 1}`));

const oneParam = (p, at) => [...unknownFields(p, PARAM_KEYS, at), ...missingFindings(["n"], p, at), ...constraintFindings(PARAM_FIELDS, p, at)];

// The map knows which controls delete things. A case that steps on one without
// saying so runs unguarded the first time somebody skips --dry, and the flag is
// a promise the author has to remember -- so `check` says it first.
function destructiveOf(c, graph) {
  if (c.destructive) return [];
  const on = (c.steps ?? []).filter((st) => st.on && graph.edgeOn.get(st.on)?.destructive);
  return on.map((st) => `${c.id}: drives ${st.on}, which the map marks destructive — declare "destructive": true`);
}

// A case that makes an object gets re-run -- after a selector fix, from CI.
// Without a guard the second run silently creates a duplicate in a real
// environment. ANY skip-if used to satisfy this, including one at the very end:
// that asks "did I just do this twice?", which is a report, not a guard. It has
// to come before the first step that changes anything.
// Which verbs mutate is asked of the registry, not spelled out here: `ACTS minus
// goto` was an enumeration pretending to be a concept, and a new act -- core's or
// a project's -- would have been missed.
function createsOf(c, dsl) {
  if (!c.creates) return [];
  const steps = c.steps ?? [];
  const guard = steps.findIndex((st) => st.do === "skip-if");
  const mutates = steps.findIndex((st) => dsl.verbsWhere("changes").has(st.do));
  return unguarded(guard, mutates) ? [`${c.id}: creates something but has no skip-if guard before its first mutating step — a re-run would make a duplicate`] : [];
}

const unguarded = (guard, mutates) => guard < 0 || (mutates >= 0 && guard > mutates);
