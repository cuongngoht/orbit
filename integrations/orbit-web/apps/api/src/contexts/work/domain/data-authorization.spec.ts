import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { grantOf, sharedSourcesOf, type DataFacts } from "./data-authorization.js";

const base: DataFacts = { leadId: null, missionSources: [], repositories: false, leadSources: [], shares: [], waitsFor: [], parts: [] };

describe("what one attempt may read", () => {
  test("the root reads the mission's sources and its repositories, and supervises its direct parts' latest hand-ins", () => {
    const g = grantOf({ ...base, missionSources: ["r1", "r2", "r1"], repositories: true, parts: [{ assignmentId: "p1", unitKey: "scan", latest: "h1" }, { assignmentId: "p2", unitKey: "sum", latest: null }] });
    assert.deepEqual(g.sources.map((s) => [s.revisionId, s.origin]), [["r1", "mission"], ["r2", "mission"]]);
    assert.equal(g.repositories, true);
    assert.deepEqual(g.handoffs, [{ handoffId: "h1", assignmentId: "p1", unitKey: "scan", mode: "full", origin: "supervision", ref: null }]);
  });

  test("a part reads only what its lead shared: never the mission's sources by default, never a repository unless explicitly shared by a lead that holds it", () => {
    const g = grantOf({ ...base, leadId: "lead", missionSources: ["r1", "r2"], repositories: true, leadSources: ["r1", "r2"] });
    assert.deepEqual([g.sources, g.handoffs, g.repositories], [[], [], false]);
    const shared = grantOf({ ...base, leadId: "lead", leadRepositories: true, shareRepositories: true });
    assert.equal(shared.repositories, true);
    assert.deepEqual(shared.withheld, []);
    const unauthorized = grantOf({ ...base, leadId: "lead", leadRepositories: false, shareRepositories: true });
    assert.equal(unauthorized.repositories, false);
    assert.equal(unauthorized.withheld.length, 1);
  });

  test("a source share gives a source the lead reads; one beyond the lead's is withheld and said", () => {
    const g = grantOf({ ...base, leadId: "lead", leadSources: ["r1"], shares: [{ id: "s1", kind: "source", revisionId: "r1" }, { id: "s2", kind: "source", revisionId: "r9" }, { id: "s3", kind: "source", revisionId: "r1" }] });
    assert.deepEqual(g.sources, [{ revisionId: "r1", origin: "share", ref: "s1" }]);
    assert.equal(g.withheld.length, 1);
    assert.match(g.withheld[0] as string, /r9/);
  });

  test("a predecessor's hand-in is given once accepted, as shared (summary or full); one of a part it does not wait for never", () => {
    const shares = [{ id: "s1", kind: "handoff" as const, originAssignmentId: "a", mode: "summary" as const }, { id: "s2", kind: "handoff" as const, originAssignmentId: "x", mode: "full" as const }];
    const before = grantOf({ ...base, leadId: "lead", shares, waitsFor: [{ assignmentId: "a", unitKey: "research", accepted: null }] });
    assert.deepEqual(before.handoffs, []);
    assert.equal(before.withheld.length, 2);
    const after = grantOf({ ...base, leadId: "lead", shares, waitsFor: [{ assignmentId: "a", unitKey: "research", accepted: "h7" }] });
    assert.deepEqual(after.handoffs, [{ handoffId: "h7", assignmentId: "a", unitKey: "research", mode: "summary", origin: "share", ref: "s1" }]);
  });

  test("one hand-in shared twice is given once, in the widest mode", () => {
    const g = grantOf({ ...base, leadId: "lead", shares: [{ id: "s1", kind: "handoff", originAssignmentId: "a", mode: "summary" }, { id: "s2", kind: "handoff", originAssignmentId: "a", mode: "full" }], waitsFor: [{ assignmentId: "a", unitKey: "research", accepted: "h7" }] });
    assert.deepEqual(g.handoffs.map((h) => [h.handoffId, h.mode]), [["h7", "full"]]);
  });

  test("a lead shares only what it reads: all of it, or the labels it reads", () => {
    const held = [{ label: "S1", revisionId: "r1" }, { label: "S2", revisionId: "r2" }];
    assert.deepEqual(sharedSourcesOf(["all"], held), { revisionIds: ["r1", "r2"], problems: [] });
    assert.deepEqual(sharedSourcesOf(["s2", "S2"], held), { revisionIds: ["r2"], problems: [] });
    assert.equal(sharedSourcesOf(["S3"], held).problems.length, 1);
  });
});
