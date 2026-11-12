// src/policy.mjs is the one answer the resolver and the MCP gate share: of several verdicts the STRICTEST stands --
// deny over approval over allow -- so a call held to more than one rule is never let through by the looser one.
import assert from "node:assert/strict";
import { test } from "node:test";
import { capabilityVerdict, operationOf, operationVerdict, strictest, undeclaredVerdict } from "../src/policy.mjs";

test("deny stands over approval over allow, whichever order they come in, and nothing at all is allow", () => {
  for (const [said, want] of [[["approval", "deny"], "deny"], [["deny", "approval"], "deny"], [["allow", "approval"], "approval"], [["approval", "allow"], "approval"], [["allow", "deny"], "deny"], [["nope", "allow"], "allow"], [[], "allow"]]) assert.equal(strictest(said), want, said.join(" + "));
});

test("a call that names no capability is held to the strictest verdict over everything the resource provides", () => {
  const policy = { capabilities: { "a.read": "approval", "a.drop": "deny" }, default: "allow" };
  assert.equal(undeclaredVerdict(policy, ["a.read", "a.drop", "a.list"]), "deny");
  assert.equal(undeclaredVerdict(policy, ["a.list", "a.read"]), "approval");
  assert.equal(capabilityVerdict({ ...policy, workflows: { w: { "a.drop": "approval" } } }, "a.drop", "w"), "approval", "a workflow's own exception is asked first");
});

test("an operation rule only ever makes a call stricter", () => {
  const policy = { capabilities: { c: "deny" }, operations: { write: "approval" } };
  const held = (tool) => strictest([capabilityVerdict(policy, "c"), operationVerdict(policy, operationOf(tool))]);
  assert.equal(held({ annotations: {} }), "deny", "an approval on writes never loosens a deny");
  assert.equal(held({ annotations: { readOnlyHint: true } }), "deny");
});
