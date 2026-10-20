// SKILL DISCOVERY and the reusable lifecycle (0.0.4): the resolver is the only authority on who provides a capability,
// a gap is read as one word, the factory drafts only a WORKFLOW gap the policy lets it close, a skill registered once
// is reused -- pinned -- by every later workflow and session without drafting again, two sessions registering at once
// make one version, and a successor that fails leaves the version before it as it was.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { generates } from "../src/automation/intelligence.mjs";
import { planFor } from "../src/automation/loop.mjs";
import { setPolicy } from "../src/mcp/manage.mjs";
import { DISCOVERY, DISCOVERY_LABELS, discoveryOf } from "../src/skill-factory/discover.mjs";
import { gapOf } from "../src/skill-factory/gap.mjs";
import { listOf, rollback, scaffold } from "../src/skill-factory/lifecycle.mjs";
import { engineVersion } from "../src/version.mjs";
import { contextOf, next, outcome, settle, start } from "./fakes/automation.mjs";
import { again, declared, eventsOf, PROVIDES, REPO, SKILL_MD, skillWorld, spec, workflowOf } from "./fakes/skill-run.mjs";

const run = promisify(execFile);

// What a workflow would read for the capability, the way the planner and `skill-factory discover` read it.
const discovered = (s) => ((r) => ((g) => s.factory.discover({ capability: PROVIDES, resolved: r, gap: g, generates: generates(g, s.ports.settings().values) }))(r?.outcome === "provided" ? null : gapOf(r, [])))(s.resolve(PROVIDES));

const kinds = (plan) => plan.steps.map((x) => x.kind);

test("every discovery label is reachable, in order, and the last always answers", () => {
  assert.deepEqual(DISCOVERY_LABELS, ["REUSABLE", "APPROVAL_REQUIRED", "POLICY_GAP", "ENVIRONMENT_GAP", "WORKFLOW_GAP", "CAPABILITY_GAP", "UNRESOLVED"]);
  assert.equal(DISCOVERY.at(-1).when({}), true);
  assert.equal(discoveryOf({ capability: "a.b" }).label, "UNRESOLVED");
});

test("AC-02: an active, valid declared skill is selected and pinned -- nothing is drafted", async (t) => {
  const s = skillWorld(t);
  const reg = await declared(s);
  const d = discovered(s);
  assert.deepEqual([d.label, d.pin, d.runs], ["REUSABLE", reg.pin, "declared"]);
  const plan = planFor(s.ports, spec).plan;
  assert.deepEqual(kinds(plan), ["context", "playbook"], "no draft and no register step: the skill is reused");
  const st = start(s.ports, spec);
  await next(s, st.task);
  await next(s, st.task);
  assert.deepEqual(eventsOf(s, st.task, "skill").map((r) => [r.ref, r.outcome]), [[reg.pin, "REUSED"]], "the reuse decision, recorded with the exact version");
  assert.deepEqual(s.factory.drafts(), []);
  assert.equal(listOf(s.factory.store).length, 1, "still one skill, one version");
});

test("a disabled, quarantined or unverified skill is never reused: reuse first is never reuse anything", async (t) => {
  const s = skillWorld(t);
  const reg = await declared(s);
  s.factory.status(reg.id, "disabled");
  assert.notEqual(discovered(s).label, "REUSABLE");
  assert.equal(discovered(s).label, "POLICY_GAP", "a person switched it off: never drafted around");
  const q = skillWorld(t);
  const r2 = await declared(q);
  q.h.io.write(join(q.factory.store.dirOf(r2.id), "SKILL.md"), `${SKILL_MD}\nedited by hand\n`);
  assert.notEqual(discovered(q).label, "REUSABLE", "a hand-edited skill is quarantined");
});

test("AC-03: a workflow gap with every dependency eligible is closed by a generated DECLARED skill, which then runs", async (t) => {
  const s = skillWorld(t);
  assert.equal(discovered(s).label, "WORKFLOW_GAP");
  const st = start(s.ports, spec);
  assert.deepEqual(kinds(st.plan), ["context", "propose-skill", "register-skill", "playbook"]);
  await next(s, st.task);
  const proposed = await next(s, st.task);
  const draft = s.factory.drafts()[0];
  assert.ok(draft, "the propose step scaffolded the draft the host writes");
  s.factory.put({ id: draft, name: "SKILL.md", text: SKILL_MD });
  s.factory.put({ id: draft, name: "workflow.json", text: JSON.stringify(workflowOf()) });
  await settle(s.ports, st.task, outcome(proposed, { evidenceRefs: [`skill:${draft}`] }));
  const registered = await next(s, st.task);
  assert.equal(registered.stepState, "succeeded");
  const row = s.factory.current(draft);
  assert.deepEqual([row.status, row.runs], ["active", "declared"]);
  const played = await next(s, st.task);
  assert.equal(played.step, "playbook");
  assert.deepEqual(eventsOf(s, st.task, "skill").filter((r) => r.ref.includes(":")).map((r) => r.outcome), ["ACTIVE", "PINNED"], "this workflow registered it, then pinned the version it registered for its run");
  assert.equal(eventsOf(s, st.task, "skillrun").at(-1).pin, row.pin);
  assert.equal(s.server.calls.length, 1, "the generated workflow's steps were asked");
  assert.equal(s.w.view(st.task).lifecycle, "COMPLETED");
});

test("AC-04: a switched-off provider, a denied policy and a runtime that is not ready never produce a generated skill", async (t) => {
  const off = skillWorld(t, { mcpProvides: [PROVIDES] });
  off.disable("corp");
  const deny = skillWorld(t, { mcpProvides: [PROVIDES] });
  setPolicy(deny.mcp.manage, "corp", { capabilities: { [PROVIDES]: "deny" } });
  const unready = skillWorld(t, { mcpProvides: [PROVIDES], mcpEnv: {} });
  const none = skillWorld(t, { settings: { skillFactory: { maxSkillsPerTask: 0 } } });
  for (const [s, label] of [[off, "POLICY_GAP"], [deny, "POLICY_GAP"], [unready, "ENVIRONMENT_GAP"]]) {
    assert.equal(discovered(s).label, label);
    const st = start(s.ports, spec);
    assert.deepEqual(kinds(st.plan), ["context", "playbook"], `${label}: no draft is planned`);
    await next(s, st.task);
    const r = await next(s, st.task);
    assert.equal(r.state, "blocked", `${label}: the step waits for a person, and nothing is generated around it`);
    assert.deepEqual(s.factory.drafts(), []);
    assert.equal(listOf(s.factory.store).length, 0);
  }
  assert.deepEqual(kinds(start(none.ports, spec).plan), ["context", "playbook"], "a person allows no generated skill: none is planned");
});

test("AC-04: a generated skill whose workflow needs what nothing provides is refused at registration, and nothing is registered", async (t) => {
  const s = skillWorld(t);
  const st = start(s.ports, spec);
  await next(s, st.task);
  const proposed = await next(s, st.task);
  const draft = s.factory.drafts()[0];
  s.factory.put({ id: draft, name: "SKILL.md", text: SKILL_MD });
  s.factory.put({ id: draft, name: "workflow.json", text: JSON.stringify(workflowOf({ notes: { capability: "release.nobody.search" } })) });
  const settled = await settle(s.ports, st.task, outcome(proposed, { evidenceRefs: [`skill:${draft}`] }));
  assert.equal(settled.step, "propose-skill");
  assert.equal(s.w.view(st.task).receipts.find((r) => r.domain === "skill" && r.ref === draft)?.outcome, "DRAFT_REFUSED", "the draft read back is refused by the contract");
  assert.equal(listOf(s.factory.store).length, 0, "a capability nothing provides is a person's to decide; no skill is registered on it");
  assert.ok(s.factory.verify(draft).findings.some((f) => f.id === "SF_NEED_UNPROVIDED"));
});

test("AC-14: a second session reuses the skill the first one generated, with no draft and no registration", async (t) => {
  const first = skillWorld(t);
  const reg = await declared(first);
  const second = skillWorld(t, { base: first.base, session: "sess-2" });
  const plan = planFor(second.ports, spec).plan;
  assert.deepEqual(kinds(plan), ["context", "playbook"]);
  const st = start(second.ports, spec);
  await next(second, st.task);
  await next(second, st.task);
  assert.equal(eventsOf(second, st.task, "skillrun").at(-1).pin, reg.pin, "the second session ran the version the first registered");
  assert.deepEqual(second.factory.drafts(), []);
  assert.equal(listOf(second.factory.store).length, 1);
});

test("AC-13: two sessions registering the same draft at once, as two processes, make ONE active version -- and the registry stays whole", async (t) => {
  const s = skillWorld(t);
  const draft = scaffold(s.factory.store, { provides: PROVIDES, values: s.ports.settings().values, engineVersion: engineVersion() });
  s.factory.put({ id: draft.id, name: "SKILL.md", text: SKILL_MD });
  s.factory.put({ id: draft.id, name: "workflow.json", text: JSON.stringify(workflowOf()) });
  const at = String(Date.now() + 600);
  const child = join(REPO, "test", "fakes", "register-child.mjs");
  const outs = await Promise.all([1, 2].map(() => run(process.execPath, [child, s.base, draft.id, at], { cwd: REPO })));
  const results = outs.map((o) => JSON.parse(o.stdout.trim().split("\n").at(-1)));
  assert.equal(results.every((r) => r.ok), true, JSON.stringify(results));
  assert.equal(new Set(results.map((r) => r.pin)).size, 1, "both were told the same version");
  assert.equal(results.filter((r) => r.reused).length, 1, "one placed it, the other was told what it became");
  const rows = listOf(s.factory.store);
  assert.equal(rows.length, 1);
  assert.deepEqual([rows[0].version, rows[0].status], ["0.1.0", "active"]);
  assert.equal(existsSync(join(s.factory.store.paths.room, ".lock")), false, "no lock was left behind");
});

test("AC-15: a successor that fails its contract leaves the version before it active and running; a rollback is a new, auditable version", async (t) => {
  const s = skillWorld(t);
  const v1 = await declared(s);
  const broken = await declared(s, { wf: workflowOf({ notes: { after: ["notes"] } }), values: again(s) }).catch((e) => ({ ok: false, error: e }));
  assert.equal(broken.ok, false, "the successor was refused");
  const after = listOf(s.factory.store);
  assert.deepEqual([after.length, after[0].pin, after[0].status, after[0].offered], [1, v1.pin, "active", true], "the version before it is untouched");
  const st = start(s.ports, spec);
  await next(s, st.task);
  await next(s, st.task);
  assert.equal(eventsOf(s, st.task, "skillrun").at(-1).pin, v1.pin, "a workflow still runs the valid version");
  for (const d of s.factory.drafts()) s.h.io.remove(s.factory.store.draftDir(d));
  const v2 = await declared(s, { text: `${SKILL_MD}\nVersion two.\n`, values: again(s) });
  assert.equal(v2.ok, true);
  const back = rollback(s.factory.store, v1.id, "0.1.0", { values: s.ports.settings().values, deps: (await import("../skills/orbit-help/factory.mjs")).depsOf(REPO, s.h.io, s.resolve), by: "person", at: "2026-10-20T10:00:00.000Z", engineVersion: engineVersion() });
  assert.equal(back.ok, true);
  const row = listOf(s.factory.store)[0];
  assert.deepEqual([row.version, row.rolledBackTo, row.registeredBy, row.phase], ["0.1.2", "0.1.0", "person", "ROLLED_BACK"], "the rollback is a new version that says which one it restored, and who");
  assert.equal(s.factory.workflow(v1.pin).pin, v1.pin, "the first version is still read by its pin, from where it is kept");
  assert.equal(eventsOf(s, st.task, "skillrun").at(-1).pin, v1.pin, "the finished run's history is untouched");
});
