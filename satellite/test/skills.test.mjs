// THE SKILL FACTORY, end to end through Orbit's REAL factory (skills/orbit-help/factory.mjs) on a temporary store: a
// capability nothing provides is scaffolded, written by the host, held to Orbit's playbook contract, registered,
// pinned as a Satellite skill and handed to the agent run that needs it -- and a later mission, in a later session,
// REUSES it without generating anything. Once a person disables the playbook, nothing pins it and nothing is
// generated to get around them.
import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { effectiveOf } from "../../src/automation/settings.mjs";
import { realIo } from "../../src/store/io.mjs";
import { factoryPort } from "../../skills/orbit-help/factory.mjs";
import { narrowedFactory } from "../cli/bind.mjs";
import { start } from "../src/mission/loop.mjs";
import { worldOf } from "../src/mission/world.mjs";
import { act, explorerRole, exploreUnit, intentFor } from "./fakes/flow.mjs";
import { satelliteWorld } from "./fakes/world.mjs";

const CAP = "payment.confirmation.trace";

const PLAYBOOK = (id) => `---\nname: ${id}\ndescription: Trace a payment confirmation through the project's own records and say which step lost it.\nuser-invocable: false\n---\n\n# Trace a payment confirmation\n\n1. Read the handoffs the unit rests on.\n2. Name each step the confirmation passes and the file that shows it.\n3. End with what still needs a person.\n`;

const RESOLVER = { [CAP]: { capability: CAP, outcome: "gap", why: "nothing here provides it" }, "repository.read": { capability: "repository.read", outcome: "provided", provider: { kind: "builtin", id: "local-checkout", key: "orbit:local-checkout", ownership: "orbit" } }, "release.approval": { capability: "release.approval", outcome: "decision", why: "a person decides" } };

function factoryWorld(t, store) {
  const root = store ?? realpathSync(mkdtempSync(join(tmpdir(), "satellite-skills-")));
  if (!store) t.after(() => rmSync(root, { recursive: true, force: true }));
  const full = factoryPort({ paths: { storeRoot: root }, io: realIo() }, () => effectiveOf([]).values, (cap) => RESOLVER[cap] ?? null);
  return { root, full, factory: narrowedFactory(full), resolve: (cap) => RESOLVER[cap] ?? { capability: cap, outcome: "cannot-tell" } };
}

async function analyzed(w) {
  const { mission, goalDigest } = start(w, { goal: "Find which step loses the payment confirmation." });
  await act(w, mission, { kind: "analyze", intent: intentFor(goalDigest) });
  await act(w, mission, { kind: "plan", units: [exploreUnit()] });
  return mission;
}

async function generatedSkill(w, mission) {
  const drafted = await act(w, mission, { kind: "resolve-skill", capability: CAP, unit: "wu-1" });
  await act(w, mission, { kind: "write-skill", draft: drafted.result.draft, files: [{ name: "SKILL.md", text: PLAYBOOK(drafted.result.draft) }] });
  const valid = await act(w, mission, { kind: "validate-skill", draft: drafted.result.draft });
  const registered = await act(w, mission, { kind: "register-skill", draft: drafted.result.draft, unit: "wu-1" });
  return { drafted, valid, registered };
}

test("a gap is drafted, written, validated, registered and pinned, then handed to the run as its playbook", async (t) => {
  const f = factoryWorld(t);
  const w = { ...satelliteWorld(), factory: f.factory, resolve: f.resolve };
  const mission = await analyzed(w);
  const s = await generatedSkill(w, mission);
  assert.deepEqual([s.drafted.outcome, s.valid.outcome, s.registered.outcome], ["drafted", "valid", "registered"]);
  await act(w, mission, { kind: "resolve-role", ...explorerRole() });
  await act(w, mission, { kind: "resolve-template", unit: "wu-1" });
  const env = (await act(w, mission, { kind: "dispatch", unit: "wu-1" })).result.envelope;
  assert.deepEqual([env.contextSlice.skills[0].pin, env.contextSlice.skills[0].capability], [s.registered.result.pin, CAP]);
  assert.match(env.contextSlice.skills[0].playbook, /Trace a payment confirmation/);
  assert.deepEqual(worldOf(w, mission).journal.read().filter((r) => r.kind.startsWith("skill.")).map((r) => r.kind), ["skill.discovered", "skill.generated", "skill.written", "skill.validated", "skill.registered", "skill.invoked"]);
});

test("a later session's mission REUSES the registered skill: same pin, no draft", async (t) => {
  const f = factoryWorld(t);
  const first = { ...satelliteWorld(), factory: f.factory, resolve: f.resolve };
  const pin = (await generatedSkill(first, await analyzed(first))).registered.result.pin;
  const later = { ...first, session: "fedcba9876543210" };
  const mission = await analyzed(later);
  const again = await act(later, mission, { kind: "resolve-skill", capability: CAP, unit: "wu-1" });
  assert.deepEqual([again.outcome, again.result.pin, f.full.drafts().length], ["reused", pin, 0]);
});

test("once a person disables the playbook, no mission pins it, dispatch refuses it, and nothing is generated around it", async (t) => {
  const f = factoryWorld(t);
  const w = { ...satelliteWorld(), factory: f.factory, resolve: f.resolve };
  const mission = await analyzed(w);
  const s = await generatedSkill(w, mission);
  await act(w, mission, { kind: "resolve-role", ...explorerRole() });
  await act(w, mission, { kind: "resolve-template", unit: "wu-1" });
  f.full.status(s.drafted.result.draft, "disabled", { by: "person" });
  const blocked = await act(w, await analyzed(w), { kind: "resolve-skill", capability: CAP, unit: "wu-1" });
  const dispatch = await act(w, mission, { kind: "dispatch", unit: "wu-1" });
  assert.deepEqual([blocked.outcome, blocked.result.label, f.full.drafts().length, dispatch.rule], ["blocked", "WITHDRAWN", 0, "SKILL_WITHDRAWN"]);
});

test("a capability a provider serves is wrapped and reused, and one that is a person's decision is blocked", async (t) => {
  const f = factoryWorld(t);
  const w = { ...satelliteWorld(), factory: f.factory, resolve: f.resolve };
  const mission = await analyzed(w);
  const read = await act(w, mission, { kind: "resolve-skill", capability: "repository.read", unit: "wu-1" });
  const approval = await act(w, mission, { kind: "resolve-skill", capability: "release.approval" });
  assert.deepEqual([read.outcome, read.result.provider.key, approval.outcome, approval.result.label], ["reused", "orbit:local-checkout", "blocked", "APPROVAL_REQUIRED"]);
});

test("a playbook that breaks Orbit's contract is invalid and never registered", async (t) => {
  const f = factoryWorld(t);
  const w = { ...satelliteWorld(), factory: f.factory, resolve: f.resolve };
  const mission = await analyzed(w);
  const drafted = await act(w, mission, { kind: "resolve-skill", capability: CAP });
  await act(w, mission, { kind: "write-skill", draft: drafted.result.draft, files: [{ name: "SKILL.md", text: "no frontmatter at all" }] });
  const valid = await act(w, mission, { kind: "validate-skill", draft: drafted.result.draft });
  const registered = await act(w, mission, { kind: "register-skill", draft: drafted.result.draft });
  assert.deepEqual([valid.outcome, registered.outcome, f.full.list().length], ["invalid", "refused", 0]);
});
