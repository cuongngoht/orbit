// A reader that is one of the PROJECT's own registered capabilities -- typically a
// small adapter over a command line tool, generated once and verified through the
// real extension loader (src/extensions/lifecycle.mjs), then reused by every later
// session.
//
// It is asked through the same door every other capability invocation uses
// (src/capability/invoke.mjs), with no page behind it and no case, exactly as an
// investigation asks a read-only capability for a count (src/investigation/data.mjs).
// So its input is held to its own declared schema, a mutating one is refused here
// and by the gate besides, and a missing command is BLOCKED by the tools gate rather
// than reported as anything about the work item.
import { Refused } from "../../errors.mjs";
import { ACQUISITION_IDS } from "../contract-v1.mjs";
import { invokeCapability } from "../../capability/invoke.mjs";
import { answered } from "./answer.mjs";

// What a capability can answer: its own id when that is an acquisition id, and
// whatever it says it provides. Nothing it does not declare.
const providesOf = (cap) => [...new Set([cap.id, ...(cap.provides ?? [])])].filter((p) => ACQUISITION_IDS.includes(p));

// The input keys the capability DECLARED. One that declares no schema is taken at
// its word and gets everything; one that does is never sent a key it did not name,
// which the input gate would refuse as unknown.
function inputFor(cap, identity, capability) {
  const wanted = { organization: identity.organization, project: identity.project, id: identity.id, ref: identity.id, capability };
  const declared = cap.inputSchema ? Object.entries(wanted).filter(([k]) => k in cap.inputSchema) : Object.entries(wanted);
  return Object.fromEntries(declared.filter(([, v]) => v !== undefined));
}

function checked(cap, capability) {
  if (cap.mutates) throw new Refused(`${cap.id} declares that it can change external state — a reader of requirements must not`);
  if (!providesOf(cap).includes(capability)) throw new Refused(`${cap.id} does not provide ${capability} (it provides ${providesOf(cap).join(", ") || "no acquisition"})`);
}

async function read(ctx, cap, identity, capability) {
  checked(cap, capability);
  const run = { c: { id: "sources" }, page: false, values: {} };
  const raw = invokeCapability(ctx, run, { capability: cap.id, input: inputFor(cap, identity, capability) });
  return answered(raw, capability, `capability ${cap.id}`, identity);
}

// `ctx` is the context invokeCapability needs; `cap` a registry entry
// (src/capability/registry.mjs). The key is the capability's own id, which is also
// the key the resource registry lists it under.
export const capabilityReader = (ctx, cap) => ({ key: cap.id, kind: "capability", provides: providesOf(cap), resolves: () => null, read: (identity, capability) => read(ctx, cap, identity, capability) });
