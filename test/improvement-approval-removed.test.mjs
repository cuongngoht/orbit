// A candidate that removes a step a person approved stops asking a person: that is a weakening, required or optional.
import assert from "node:assert/strict";
import { test } from "node:test";
import { oracleOf, weakenings } from "../src/improvement/oracle.mjs";

const step = (id, over = {}) => ({ id, capability: `${id}.read`, required: true, evidence: "report", approval: "none", outputs: { hits: { type: "count", path: "hits" } }, success: [{ output: "hits", op: "gte", value: 1 }], ...over });
const wf = (...steps) => ({ api: "orbit.skill-workflow/v1", steps });
const ids = (parent, candidate) => weakenings(oracleOf("workflow", parent), oracleOf("workflow", candidate)).map((w) => w.id);

test("removing an optional step that waited for a person drops the approval", () => {
  assert.ok(ids(wf(step("read"), step("sign-off", { required: false, approval: "owner" })), wf(step("read"))).includes("APPROVAL_DROPPED"));
});

test("removing an optional step that waited for nobody drops nothing", () => {
  assert.deepEqual(ids(wf(step("read"), step("tidy", { required: false, outputs: {}, success: [] })), wf(step("read"))), []);
});
