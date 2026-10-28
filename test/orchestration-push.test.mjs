// Delivery (0.2.0): a verified change is COMMITTED in the task's own workspace autonomously, and that exact commit is
// PUSHED only once a person approved exactly that push -- repository, remote, URL, ref, commit, force -- in Orbit
// Control. The approval is spent before the push starts, never twice, never by a changed push; a rejected or expired
// one pushes nothing; and an interrupted push is read back from the remote, never sent again.
import { test } from "node:test";
import assert from "node:assert/strict";
import { apply } from "../src/task/ops.mjs";
import { reconcile, step } from "../src/orchestration/loop.mjs";
import { TEST, decided, orchestrationWorld, testing } from "./fakes/orchestration.mjs";

const URL = "https://bot:tok3n@git.example.invalid/acme/repo.git";

// Planned, changed, built and tested: the task is in REVIEWING, verified, with nothing asked of anybody.
async function reviewing(t, opts = {}) {
  const o = orchestrationWorld(t, opts);
  const at = await testing(o);
  await at.go({ kind: "check", command: TEST });
  assert.equal(o.w.view(at.id).stage, "REVIEWING");
  return { o, ...at };
}

const control = (o) => ({ ...o.w.ctx, door: "control" });

const approve = (o, id, apr = "apr-1") => apply(control(o), id, "approve", { approval: apr, human: true, expected: o.w.view(id).revision });

test("autonomous end to end: a requirement goes to a verified, reviewed, COMPLETED change with a local commit -- and nobody is asked anything", async (t) => {
  const { o, id, go } = await reviewing(t);
  const committed = await go({ kind: "commit" });
  assert.equal(committed.outcome, "succeeded");
  assert.deepEqual(o.ws.state.commits.map((c) => [c.task, c.branch]), [[id, `orbit/${id}`]], "committed on the task's own branch, in its own workspace");
  assert.match(committed.receipts[0], /^commit:[0-9a-f]{40}$/);
  await go({ kind: "review" });
  const view = o.w.view(id);
  assert.deepEqual([view.lifecycle, view.approvals], ["COMPLETED", []], "no approval was asked for on the way");
  assert.deepEqual(o.ws.state.pushes, [], "and nothing left the machine");
});

test("a commit is made only of a verified change: before the tests passed it is refused, and nothing is committed", async (t) => {
  const o = orchestrationWorld(t);
  const { id, go } = await testing(o);
  await assert.rejects(go({ kind: "commit" }), /STAGE: TESTING does not allow commit/);
  assert.deepEqual(o.ws.state.commits, []);
  assert.equal(o.w.view(id).approvals.length, 0);
});

test("a push waits for a person: one request, shown with what it publishes, never granted by the agent or the coordinator that asked", async (t) => {
  const { o, id, go } = await reviewing(t);
  await go({ kind: "commit" });
  await assert.rejects(go({ kind: "push" }, { approval: "apr-1" }), /APPROVAL_UNKNOWN|OTHER_ACTION|NOT_GRANTED/);
  const asked = await go({ kind: "push" }, { reason: "the objective asks for the change on a branch for review" });
  assert.deepEqual([asked.state, asked.approval, asked.boundary], ["waiting-approval", "apr-1", "GIT_PUSH"]);
  const apr = o.w.view(id).approvals[0];
  const sha = o.ws.state.commits[0].sha;
  assert.deepEqual([apr.action, apr.environment, apr.boundary, apr.title, apr.destructive], ["repository.push", "origin", "GIT_PUSH", "Git push", false]);
  assert.deepEqual(apr.shows, { remote: "origin", at: "git.example.invalid/acme/repo.git", ref: `refs/heads/orbit/${id}`, commit: sha.slice(0, 12), force: "false" }, "the commit as a person reads one; the approval is bound to all of it");
  assert.equal(apr.risk, `publishes commit ${sha.slice(0, 12)} to refs/heads/orbit/${id} on origin (git.example.invalid/acme/repo.git)`);
  assert.doesNotMatch(JSON.stringify(o.w.tasks.read(id)), /tok3n/, "the URL's credential is never kept: the journal holds its digest");
  assert.equal(o.w.view(id).lifecycle, "WAITING_APPROVAL");
  await assert.rejects(go({ kind: "push" }), /WAITING: an action waits for a person's decision in Orbit Control/, "evaluating the same push again while it waits creates nothing");
  assert.equal(o.w.view(id).approvals.length, 1);
  assert.throws(() => apply(o.w.ctx, id, "approve", { approval: "apr-1", human: true, expected: o.w.view(id).revision }), /PERSON_UNPROVEN/, "an agent's terminal relaying --human");
  assert.throws(() => apply({ ...o.w.ctx, door: "coordinator" }, id, "approve", { approval: "apr-1", human: true, expected: o.w.view(id).revision }), /PERSON_UNPROVEN/, "the coordinator's own door");
  assert.deepEqual(o.ws.state.pushes, [], "nothing was pushed on the asking");
});

test("once approved in Control: a changed push cannot spend it; the exact push runs ONCE, the approval spent before it starts; a second use is refused", async (t) => {
  const { o, id, go } = await reviewing(t);
  o.ws.state.remotes.set("upstream", "https://git.example.invalid/upstream/repo.git");
  await go({ kind: "commit" });
  await go({ kind: "push" });
  approve(o, id);
  for (const changed of [{ branch: "main" }, { force: true }, { remote: "upstream" }]) await assert.rejects(go({ kind: "push", ...changed }, { approval: "apr-1" }), /OTHER_ACTION/, JSON.stringify(changed));
  const pushed = await go({ kind: "push" }, { approval: "apr-1" });
  assert.equal(pushed.outcome, "succeeded");
  const sha = o.ws.state.commits[0].sha;
  assert.deepEqual(o.ws.state.pushes.map((p) => [p.url, p.sha, p.ref, p.force]), [[URL, sha, `refs/heads/orbit/${id}`, false]], "exactly the approved commit, ref and remote");
  const kinds = o.w.kinds(id);
  assert.equal(kinds.lastIndexOf("approval-consumed") + 1, kinds.lastIndexOf("action-started"), "consumed BEFORE the push started");
  await assert.rejects(go({ kind: "push" }, { approval: "apr-1" }), /NOT_GRANTED: apr-1 is consumed/);
  assert.equal(o.ws.state.pushes.length, 1);
  assert.equal(o.w.view(id).approvals[0].outcome, "succeeded", "a viewer reads what became of the protected push");
  await go({ kind: "review" });
  assert.equal(o.w.view(id).lifecycle, "COMPLETED", "and work goes on: the review completes the task");
});

test("a force push is its own action with its own risk -- an ordinary push's approval never covers it", async (t) => {
  const { o, id, go } = await reviewing(t);
  await go({ kind: "commit" });
  await go({ kind: "push" });
  approve(o, id);
  const forced = await go({ kind: "push", force: true });
  assert.deepEqual([forced.state, forced.approval], ["waiting-approval", "apr-2"]);
  assert.match(o.w.view(id).approvals[1].risk, /^FORCE push: replaces refs\/heads\/orbit\/.* whatever the remote held there that this commit lacks is lost$/);
});

test("a remote pointed elsewhere after the approval: the approval is spent, and nothing is pushed", async (t) => {
  const { o, id, go } = await reviewing(t);
  await go({ kind: "commit" });
  await go({ kind: "push" });
  approve(o, id);
  const decision = decided(o.ports, id, { kind: "push" }, { approval: "apr-1" });
  const real = o.ports.workspace.remote;
  let asks = 0;
  o.ports.workspace.remote = (name) => (++asks > 2 ? "https://git.example.invalid/somebody-else/repo.git" : real(name));
  const ran = await step(o.ports, id, decision);
  assert.equal(ran.outcome, "error");
  assert.match(ran.reason, /no longer points where the approved push was going — nothing was pushed/);
  assert.deepEqual(o.ws.state.pushes, []);
  assert.equal(o.w.view(id).approvals[0].state, "consumed", "spent, and never reusable: a push there needs one of its own");
});

test("a rejected push never runs and is never asked again; an expired approval pushes nothing", async (t) => {
  const { o, id, go } = await reviewing(t);
  await go({ kind: "commit" });
  await go({ kind: "push" });
  apply(o.w.ctx, id, "reject", { approval: "apr-1", human: true, expected: o.w.view(id).revision, reason: "not this branch" });
  await assert.rejects(go({ kind: "push" }), /REJECTED/);
  await assert.rejects(go({ kind: "push" }, { approval: "apr-1" }), /REJECTED/);
  const other = await go({ kind: "push", branch: "feature/refunds" });
  assert.equal(other.approval, "apr-2", "a different push may be asked for");
  approve(o, id, "apr-2");
  apply(o.w.ctx, id, "approval-expire", { approval: "apr-2" });
  await assert.rejects(go({ kind: "push", branch: "feature/refunds" }, { approval: "apr-2" }), /NOT_GRANTED: apr-2 is expired/);
  assert.deepEqual(o.ws.state.pushes, []);
});

test("a remote that refuses the push is the remote's answer, kept as said -- and the task goes on", async (t) => {
  const { o, id, go } = await reviewing(t);
  await go({ kind: "commit" });
  await go({ kind: "push" });
  approve(o, id);
  o.ws.state.refuse = "! [rejected] orbit/x -> orbit/x (non-fast-forward)";
  const ran = await go({ kind: "push" }, { approval: "apr-1" });
  assert.equal(ran.outcome, "failed");
  assert.match(ran.summary, /the remote refused the push: .*non-fast-forward/);
  assert.ok(o.w.view(id).receipts.some((r) => r.domain === "push" && r.outcome === "REFUSED"));
});

test("an interrupted push is READ BACK from the remote -- the ref at the commit is a push that happened -- and never sent again", async (t) => {
  const { o, id, go } = await reviewing(t);
  await go({ kind: "commit" });
  await go({ kind: "push" });
  approve(o, id);
  const push = o.ports.workspace.push;
  o.ports.workspace.push = (task, p) => {
    push(task, p);
    throw new Error("the connection dropped after the remote took it");
  };
  await assert.rejects(go({ kind: "push" }, { approval: "apr-1" }), /connection dropped/);
  o.ports.workspace.push = push;
  const out = await reconcile(o.ports, id);
  assert.deepEqual(out.settled.map((s) => [s.kind, s.outcome]), [["push", "succeeded"]]);
  assert.ok(o.w.view(id).receipts.some((r) => r.domain === "push" && r.outcome === "PUSHED" && /read back/.test(r.summary)));
  assert.equal(o.ws.state.pushes.length, 1, "read back, never pushed again");
});
