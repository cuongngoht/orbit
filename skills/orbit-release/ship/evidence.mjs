// THE EVIDENCE a SHIPPABLE ship leaves, and the gate a publish asks before anything is published (`ship.mjs
// --evidence`). The evidence names the exact source it is about -- the release commit, its git tree, the content digest
// every row's run froze, the protected paths' digest, the policy's digest -- the exact artifact (its bytes' and its
// content's digests), the harness and images that judged it, the one host that carried every model-carried row, and
// every row, repair and gate. The gate trusts none of it as written: an ordered table (`PUBLISH`) holds it to the
// checkout as it stands NOW, re-reads every run's own room, and digests the artifact again. Only PUBLISHABLE exits 0.
//
//   evidenceOf(ctx, f, delivery) -> evidence        publishableOf(g) -> { publishable, code, says }       PUBLISH
//   g: { ship, view, evidence, head: { tree, dirty }, now: { protected, policy, rows }, rooms(run), artifact }
import { identityOf } from "./rows.mjs";

const uniq = (xs) => [...new Set(xs.filter(Boolean))];

const rowEvidence = (r) => ({ id: r.row.id, case: r.row.case, requirement: r.row.req, run: r.v.run, task: r.v.task ?? null, state: r.v.state, outcome: r.v.outcome, basis: r.v.basis ?? null, cli: r.v.cli ?? null, model: r.v.model ?? null, costUsd: r.v.costUsd ?? null, costBasis: r.v.costBasis ?? null, rounds: r.v.rounds ?? null, seconds: r.v.seconds ?? null, superseded: r.v.superseded ?? [], says: r.v.says, runs: r.runs });

const repairEvidence = (x) => ({ case: x.d.case, commit: x.d.settled.commit, tree: x.d.settled.tree, patchDigest: x.d.settled.patchDigest, run: x.d.settled.run ?? null, paths: x.d.settled.paths ?? [] });

const autonomousOf = (f) => [...f.rows.values()].filter((r) => r.row.autonomous);

export function evidenceOf(ctx, f, delivery) {
  const rows = [...f.rows.values()].map(rowEvidence);
  const auto = autonomousOf(f);
  return { schema: 1, kind: "release-evidence", ship: ctx.ship.id, task: ctx.task, at: new Date(ctx.now()).toISOString(), verdict: "SHIPPABLE", mode: ctx.options.repair ? "autonomous" : "verify-only", policy: { digest: ctx.manifest.policy.digest }, start: ctx.manifest.start, source: { commit: f.cycle.commit, tree: f.cycle.treeId, digest: f.firstDigest, protected: ctx.manifest.protected.digest }, artifact: f.cycle.artifact, harness: { digest: rows.map((r) => r.run && f.rows.get(r.id)?.v.harness).find(Boolean) ?? null, images: f.cycle.images }, host: { cli: ctx.policy.host.cli, basis: ctx.policy.host.basis, image: f.host.probe?.image ?? null, reported: uniq(auto.map((r) => r.v.cli)), models: uniq(auto.map((r) => r.v.model)), endpoint: ctx.endpoint }, gates: f.gates.rows.map((g) => ({ name: g.name, ok: g.ok, detail: g.detail })), rows, repairs: f.acts.filter((x) => x.a.type === "release.integrate" && x.d.settled).map(repairEvidence), superseded: rows.filter((r) => r.superseded.length).map((r) => ({ case: r.case, controls: r.superseded })), optional: ctx.optional ?? [], totals: { usd: f.spent.usd, minutes: f.spent.minutes, cycles: f.attempts, rows: rows.length }, delivery: { needed: f.cycle.commit !== ctx.manifest.start.commit, ...(delivery ?? {}) } };
}

// ---- the publish gate --------------------------------------------------------------------------------------------------

const IN_FLIGHT = ["QUEUED", "PREPARING", "EXECUTING", "VERIFYING", "WAITING_APPROVAL", "PAUSED"];

// A run's room read again: it still names the commit, the outcome and -- for a model-carried row -- the coding host.
const agrees = (g, r) => ((room) => Boolean(room?.manifest) && room.manifest.source?.commit === g.evidence.source.commit && room.ending?.outcome === r.outcome && (!g.now.autonomous.has(r.id) || identityOf(room).basis === "coding-host"))(g.rooms(String(r.run ?? "").split(" ")[0]));

const roomsAgree = (g) => g.evidence.rows.filter((r) => r.run && g.now.single.has(r.id)).every((r) => agrees(g, r));

export const PUBLISH = [
  { code: "NO_SHIP", when: (g) => !g.ship, says: () => "no ship has run on this checkout: node skills/orbit-release/ship.mjs" },
  { code: "PENDING", when: (g) => IN_FLIGHT.includes(g.view?.lifecycle), says: (g) => `ship ${g.ship.id} is ${g.view.lifecycle.toLowerCase()}: nothing is published while its verification is pending` },
  { code: "BLOCKED", when: (g) => g.view?.lifecycle === "BLOCKED", says: (g) => `ship ${g.ship.id} is blocked: ${g.ending?.summary ?? g.view.stopReason}` },
  { code: "NOT_SHIPPABLE", when: (g) => !g.evidence || g.view?.lifecycle !== "COMPLETED", says: (g) => `ship ${g.ship.id} did not qualify this source: ${g.ending?.summary ?? g.view?.lifecycle ?? "no verdict"}` },
  { code: "TREE_MOVED", when: (g) => g.head.tree !== g.evidence.source.tree, says: (g) => `this checkout's HEAD is not the source ship ${g.ship.id} qualified (${g.evidence.source.commit.slice(0, 12)})${g.evidence.delivery?.needed ? `: apply ${g.evidence.delivery.patch} (git am) or fetch ${g.evidence.delivery.bundle}, then ask again` : ": the evidence is about another source; ship again"}` },
  { code: "DIRTY", when: (g) => g.head.dirty.length > 0, says: (g) => `uncommitted changes (${g.head.dirty.slice(0, 5).join(", ")}): the evidence is about the committed tree alone` },
  { code: "PROTECTED_MOVED", when: (g) => g.now.protected !== g.evidence.source.protected, says: () => "the harness, a check or the release itself moved since the ship ran" },
  { code: "POLICY_MOVED", when: (g) => g.now.policy !== g.evidence.policy.digest, says: () => "the release policy moved since the ship ran: what it requires is not what was held" },
  { code: "INCOMPLETE", when: (g) => g.now.rows.some((id) => !g.evidence.rows.some((r) => r.id === id && r.state === "HELD")), says: (g) => `rows the policy requires with no held evidence: ${g.now.rows.filter((id) => !g.evidence.rows.some((r) => r.id === id && r.state === "HELD")).slice(0, 6).join(", ")}` },
  { code: "UNTRUSTED", when: (g) => !roomsAgree(g), says: () => "a run's own room no longer says what the evidence says of it" },
  { code: "ARTIFACT_MISSING", when: (g) => !g.artifact.ok, says: (g) => g.artifact.says },
  { code: "PUBLISHABLE", when: () => true, says: (g) => `ship ${g.ship.id} qualified ${g.evidence.source.commit.slice(0, 12)}: every row held, on this very tree; artifact ${g.evidence.artifact.sha256.slice(0, 12)}` },
];

export const publishableOf = (g) => ((r) => ({ publishable: r.code === "PUBLISHABLE", code: r.code, says: r.says(g), ship: g.ship?.id ?? null }))(PUBLISH.find((r) => r.when(g)));
