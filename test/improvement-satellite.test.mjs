// A Satellite ROLE improved (0.3.0, ADR 0045): agent runs under one role that keep ending without evidence reaching
// their contract, in independent sessions, become one opportunity; the host proposes a successor, held to the role
// rules and published as a candidate nobody is offered through Satellite's own immutable door; the host runs one goal
// under each version and links the missions; each run is read back off its mission (the role pin its engine bound, the
// outcome it concluded on its owners' records); and the candidate is chosen through Satellite's registry -- only on
// independent sessions, and never past a person's revocation.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { effectiveOf } from "../src/automation/settings.mjs";
import { advance, analyseNow, proposeCandidate, step } from "../src/improvement/loop.mjs";
import { linkMission } from "../src/improvement/evaluators.mjs";
import { campaignOf } from "../src/improvement/loop.mjs";
import { modelOf, phaseOf } from "../src/improvement/model.mjs";
import { createImprovement } from "../src/improvement/store.mjs";
import { realIo } from "../src/store/io.mjs";
import { improvementPorts } from "../satellite/cli/improvement.mjs";
import { writeDefinition } from "../satellite/src/store/definitions.mjs";
import { writePolicy } from "../satellite/src/store/policy.mjs";
import { roomsOf } from "../satellite/src/store/rooms.mjs";

const ROLE = { id: "rol-logs-analyst", kind: "role", schemaVersion: 1, scope: "project", dependencies: [], compatibility: { profiles: ["READ_ONLY"] }, content: { displayName: "LogsAnalyst", purpose: "Analyze the logs a failure left.", responsibilities: [{ activity: "analyze", subject: "logs" }], requiredCapabilities: [], inputContract: { accepts: [] }, outputContract: { shape: "findings", fields: ["findings"] }, restrictions: ["It never changes source."], completionCriteria: ["Every finding names the record that shows it."], requestedPermissionProfile: "READ_ONLY" }, provenance: { by: "engine" } };

const satRun = (n, rolePin, outcome, { session = "s1", level = outcome === "succeeded" ? "VERIFIED" : "CONTRACT_MET", mission = "msn-00000000000a" } = {}) => ({ kind: "satellite", mission, run: `arn-${n}`, rolePin, at: `2026-10-2${n % 9}T10:00:00.000Z`, session, host: "laptop-a", outcome, level, signature: outcome === "insufficient" ? "sig-1" : null, attribution: "RUNTIME_BOUND" });

function world(t, opts = {}) {
  const root = mkdtempSync(join(tmpdir(), "orbit-improve-satellite-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const io = realIo({ host: "laptop-a" });
  const clock = { at: Date.parse("2026-10-29T00:00:00.000Z") };
  const now = () => new Date((clock.at += 1000)).toISOString();
  const sat = improvementPorts({ io, storeRoot: root, now });
  const parent = writeDefinition(io, roomsOf(root), ROLE);
  const state = { session: "sess-A", records: [satRun(1, parent.pin, "insufficient"), satRun(2, parent.pin, "insufficient"), satRun(3, parent.pin, "insufficient", { session: "s2" })], missions: {} };
  const store = createImprovement(root, io);
  const ports = { store, ctx: { store, door: "improvement", get session() { return state.session; }, host: "laptop-a", pid: 1, now }, values: () => effectiveOf([{ by: "machine", content: { improvement: opts.improvement ?? {} } }]).values, now, nowMs: () => clock.at, records: () => state.records, history: () => state.records, inputsOf: () => [], subjects: { satellite: sat.subject }, evaluation: null, missions: { read: (msn) => state.missions[msn] ?? null, runs: (msn) => state.missions[msn]?.runs ?? [] }, liveness: () => false, learn: () => ({ kept: false, because: "not under test" }), trace: () => null };
  return { root, io, ports, state, parent, sat, store };
}

const mission = (id, runs) => ({ goalDigest: "g1", runs: runs.map((r) => ({ ...r, mission: id })) });

test("a role whose runs keep ending without proof is ONE opportunity, a successor proposed by the host is a candidate nobody is offered, and two linked sessions choose it through Satellite's registry", async (t) => {
  const w = world(t);
  await analyseNow(w.ports, {});
  const id = w.store.list()[0];
  assert.equal(phaseOf(modelOf(w.store.read(id))), "GENERATING");
  const m0 = modelOf(w.store.read(id));
  assert.deepEqual([m0.meta.subjectKind, m0.meta.subjectId, m0.meta.signal, m0.diagnosis.cause], ["satellite", "rol-logs-analyst", "unverified-outcome", "definition"]);
  const asked = await step(w.ports, id);
  assert.match(asked.how, /improve\.mjs candidate/);
  const proposed = proposeCandidate(w.ports, id, { completionCriteria: [...ROLE.content.completionCriteria, "Every finding says which independent owner's record settles it."] });
  assert.equal(proposed.did, "GENERATED", JSON.stringify(proposed));
  const cand = modelOf(w.store.read(id)).candidate.pin;
  assert.equal(w.sat.subject.current("rol-logs-analyst").pin, w.parent.pin, "the candidate is offered to nobody");
  const open = await advance(w.ports, id);
  assert.equal(open.at(-1).needs, "host");
  assert.match(open.at(-1).how, /improve\.mjs link/);
  for (const [session, [b, c]] of [["sess-A", ["msn-00000000000b", "msn-00000000000c"]], ["sess-B", ["msn-00000000000d", "msn-00000000000e"]]]) {
    w.state.session = session;
    if (session === "sess-B") await advance(w.ports, id);
    w.state.missions[b] = mission(b, [satRun(4, w.parent.pin, "insufficient"), satRun(5, w.parent.pin, "insufficient")]);
    w.state.missions[c] = mission(c, [satRun(6, cand, "succeeded"), satRun(7, cand, "succeeded")]);
    linkMission(w.ports, campaignOf(w.ports, id), { mission: b, side: "baseline" });
    linkMission(w.ports, campaignOf(w.ports, id), { mission: c, side: "candidate" });
    await advance(w.ports, id);
  }
  const m = modelOf(w.store.read(id));
  assert.deepEqual(m.evaluations.map((e) => e.settled?.verdict), ["BETTER", "BETTER"]);
  assert.equal(m.promoted?.to, cand, JSON.stringify(m.gates));
  assert.equal(w.sat.subject.current("rol-logs-analyst").pin, cand, "Satellite offers the chosen role to its next mission");
});

test("a successor that drops a completion criterion or widens its profile is refused before anything runs", async (t) => {
  for (const [content, why] of [[{ completionCriteria: ["Done."] }, /CRITERION_REMOVED/], [{ requestedPermissionProfile: "IMPLEMENT" }, /CAND_TOOLS_WIDENED/]]) {
    const w = world(t);
    await analyseNow(w.ports, {});
    const id = w.store.list()[0];
    proposeCandidate(w.ports, id, content);
    await advance(w.ports, id);
    const m = modelOf(w.store.read(id));
    assert.match(`${m.rejected?.reason} ${m.rejected?.because}`, why);
    assert.equal(w.sat.subject.current("rol-logs-analyst").pin, w.parent.pin);
  }
});

test("missions that pursued different goals compare nothing, and a role a person revoked is never offered by anybody", async (t) => {
  const w = world(t);
  await analyseNow(w.ports, {});
  const id = w.store.list()[0];
  proposeCandidate(w.ports, id, { purpose: "Analyze the logs a failure left, and say which owner's record settles each finding." });
  await advance(w.ports, id);
  const cand = modelOf(w.store.read(id)).candidate.pin;
  w.state.missions["msn-00000000000b"] = { ...mission("msn-00000000000b", [satRun(4, w.parent.pin, "insufficient")]), goalDigest: "g1" };
  w.state.missions["msn-00000000000c"] = { ...mission("msn-00000000000c", [satRun(6, cand, "succeeded")]), goalDigest: "g2" };
  linkMission(w.ports, campaignOf(w.ports, id), { mission: "msn-00000000000b", side: "baseline" });
  linkMission(w.ports, campaignOf(w.ports, id), { mission: "msn-00000000000c", side: "candidate" });
  await step(w.ports, id);
  assert.equal(modelOf(w.store.read(id)).evaluations[0].settled.verdict, "INCONCLUSIVE");
  writePolicy(w.io, roomsOf(w.root).policyFile, { revoked: [{ ref: "rol-logs-analyst", because: "a person withdrew this role" }] }, { door: "control", revision: null, at: "2026-10-30T00:00:00.000Z" });
  assert.equal(w.sat.subject.current("rol-logs-analyst").status, "revoked");
  assert.throws(() => w.sat.subject.select("rol-logs-analyst", { pin: cand, expect: w.parent.pin, door: "improvement" }), (e) => e.code === "PIN_REVOKED");
});
