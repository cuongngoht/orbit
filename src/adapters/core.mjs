// The family operations, as the capabilities a case calls (ADR 0035).
//
// One capability per family operation that an adapter answers (`selects`): pageless, mutating
// exactly when an effect it allows mutates, binding one logical ref per kind the operation
// names, and carrying the operation's own parameters in `request`. Its invoke does nothing but
// ask the facade (src/adapters/dispatch.mjs), so a case on one broker and the same case on
// another are the same capability -- only the binding differs. A pack ships these
// (skills/orbit-backend-test); HTTP is not among them, because its pack answers it with a helper
// of its own, and an operation Orbit computes itself (`selects: false`) is its pack's to define.
import { CAPABILITY_API } from "../capability/contract-v1.mjs";
import { mutatingEffect } from "../topology/vocab.mjs";
import { FAMILIES } from "./families.mjs";

const OWN_HELPER = new Set(["http"]);

export const familyCapabilities = (families = FAMILIES) => families.filter((f) => !OWN_HELPER.has(f.id)).flatMap((f) => f.operations.filter((o) => o.selects).map((o) => capabilityOf(f, o)));

const capabilityOf = (f, o) => ({
  id: o.capability,
  apiVersion: CAPABILITY_API,
  doc: `${f.doc} — ${o.op}, through the adapter its bound ${o.refs[0]} resolves to${f.contractOnly ? " (no adapter is published for this family yet: a gap, never a pass)" : ""}`,
  page: false,
  mutates: o.effects.some(mutatingEffect),
  effects: [...o.effects],
  inputSchema: inputOf(o),
  required: [`${o.refs[0]}Ref`],
  invoke: (ext, input) => ext.adapters.ask(input.request ?? {}),
});

const inputOf = (o) => ({
  ...Object.fromEntries(o.refs.map((kind) => [`${kind}Ref`, { type: "string", bind: kind, doc: `the ${kind}, by its logical alias — never an address` }])),
  request: { type: "object", doc: "the operation's own parameters, handed to the adapter as they are" },
});
