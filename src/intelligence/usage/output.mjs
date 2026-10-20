// What an analyser handed back, held to the contract before anything trusts it.
//
// An analyser is registered code, and registered code can be wrong: a usage
// with no technology, a lifetime spelled as a sentence, a "type name" that is
// really a string literal it lifted out of a file. Every record is checked
// against its field table (src/intelligence/contract.mjs), and one that fails
// is DROPPED and counted -- never repaired, and never passed on. A technology
// no descriptor defines is dropped too: a usage of something the registry has
// never heard of cannot be placed on any ladder.
import { constraintFindings, missingFindings } from "../../constraints.mjs";
import { TYPE_NAME, USAGE_FIELDS, USAGE_REQUIRED, WIRING_FIELDS, WIRING_REQUIRED } from "../contract.mjs";

export function checkedOutput(raw, known, where) {
  const out = isObject(raw) ? raw : {};
  const usages = listOf(out.usages).filter((u) => fits(USAGE_FIELDS, USAGE_REQUIRED, u) && known.has(u.technology));
  const wirings = listOf(out.wirings).filter((w) => fits(WIRING_FIELDS, WIRING_REQUIRED, w));
  const dropped = listOf(out.usages).length + listOf(out.wirings).length - usages.length - wirings.length;
  return { usages, wirings, defines: listOf(out.defines).filter((d) => typeof d === "string" && TYPE_NAME.test(d)), unknowns: [...listOf(out.unknowns).filter((u) => typeof u === "string"), ...(dropped ? [`${where}: ${dropped} record(s) the analyser returned were not in the contract's shape, and were dropped`] : [])] };
}

const fits = (fields, required, row) => isObject(row) && !missingFindings(required, row, "r").length && !constraintFindings(fields, row, "r").length && Object.keys(row).every((k) => k in fields);

const listOf = (v) => (Array.isArray(v) ? v : []);

const isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
