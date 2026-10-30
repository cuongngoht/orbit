// Autonomous improvement as control-server answers it, in memory: one project with one campaign that qualified and
// waits for a person. Like the real server a decision names the campaign revision the page read (a stale one is a 409),
// a phase that does not take a decision is a 409, and the project's bounds are saved on the revision read.
import type { Campaign, ImprovementOverview } from "../features/improvement/improvement.types";
import { reply, type Call } from "./fakeServer";

const CAND = "release-x:0.1.1:bbbbbbbb";
const PIN = "release-x:0.1.0:aaaaaaaa";

const side = (met: number) => ({ runs: 3, met, verified: 0, failing: 3 - met, blocked: 0, retries: 0, calls: 6, ms: null });

export const campaign = (over: Partial<Campaign> = {}): Campaign => ({
  id: "imp-0123456789ab", revision: 21, phase: "AWAITING_AUTHORITY", say: "qualified; a person promotes it in Orbit Control", carrier: "person", mode: "VERIFYING",
  subject: { kind: "skill", id: "release-x" }, pin: PIN, opportunity: "opp-0123456789abcdef", signal: "contract-violation", category: "definition", signature: ["notes"], evidence: ["skillrun:tsk-000000000001/srun-1"], sessions: 2, runs: 4,
  diagnosis: { cause: "definition", confidence: "high", hypothesis: "release-x declares an output contract on notes that its providers' answers do not meet", contradicting: [], unknowns: ["cost in tokens (not observable through owner gates)"], test: "baseline and candidate on the same inputs", expected: "the candidate meets notes" },
  proposal: { strategy: "successor", change: "a successor that changes only how notes reads its answer" },
  candidate: { id: "cand-0123456789ab", pin: CAND, digest: "d".repeat(64), successorOf: PIN, reused: false, changed: ["workflow.json"], at: "2026-10-30T00:00:00.000Z" },
  evaluations: ["a", "b"].map((s, i) => ({ evaluation: `ev${i + 1}`, task: `tsk-00000000000${i + 2}`, at: "2026-10-30T00:00:00.000Z", session: s, host: "laptop-a", baseline: PIN, candidate: CAND, planned: 6, recorded: 6, links: [], open: false, verdict: "BETTER", because: "the candidate met 3 of 3 run(s) where the baseline met 0", regressions: [], metrics: { baseline: side(0), candidate: side(3), delta: { calls: 0, retries: 0, ms: null }, ratios: [{ id: "candidate-met", numerator: 3, denominator: 3, value: 1 }], unknown: [{ id: "tokens", because: "owner gates keep digests, never tokens" }] }, attribution: ["RUNTIME_BOUND"] })),
  open: null, aggregate: { verdict: "BETTER", because: "better in 2 independent session(s)", sessions: 2, evaluations: 2 },
  gates: { rows: [{ id: "CANDIDATE_INTACT", holds: true }, { id: "POLICY_ALLOWS", holds: false }], failed: "POLICY_ALLOWS", at: "2026-10-30T00:00:00.000Z" }, awaiting: "automatic promotion is off",
  promotion: null, observations: [], regression: null, rollback: null, blocked: null, rejected: null, ended: null, learned: null, lastAt: "2026-10-30T00:00:00.000Z",
  events: [{ event: "improvement.detected", campaign: "imp-0123456789ab", n: 0, at: "2026-10-29T00:00:00.000Z" }, { event: "candidate.awaiting_authority", campaign: "imp-0123456789ab", n: 20, at: "2026-10-30T00:00:00.000Z" }],
  ...over,
});

export function fakeImprovement() {
  const state = { campaign: campaign(), settingsRev: null as string | null, values: { detect: true, generate: true, evaluate: true, promote: false, minSessions: 2 } as Record<string, unknown>, calls: [] as Call[] };
  const overview = (): ImprovementOverview => ({ version: 1, project: "repo-shop", settings: { fields: [{ key: "promote", path: "improvement.promote", type: "boolean", values: null, min: null, max: null, default: true, narrow: "and", say: "let the engine promote" }, { key: "minSessions", path: "improvement.minSessions", type: "integer", values: null, min: 2, max: 10, default: 2, narrow: "max", say: "independent sessions" }], values: state.values as Record<string, boolean | number | string | null>, by: { promote: "project", minSessions: "default" }, revision: state.settingsRev, machineRevision: null }, analysed: null, phases: { [state.campaign.phase]: 1 }, opportunities: { total: 1, eligible: 1, unreadable: 0 }, campaigns: [{ id: state.campaign.id, phase: state.campaign.phase, subject: "release-x", pin: PIN, candidate: CAND, signal: "contract-violation", outcome: state.campaign.ended?.outcome ?? null, carrier: state.campaign.carrier, revision: state.campaign.revision, lastAt: null }], metrics: [{ id: "verified-improvement", say: "candidates proven better / comparable campaigns", numerator: 1, denominator: 1, value: 1, unit: "ratio", because: null }, { id: "reuse", say: "runs of a promoted version / runs since", numerator: null, denominator: null, value: null, unit: "ratio", because: "no promoted version has run yet" }] });
  const decide = (call: Call, act: string) => {
    const body = call.body as { expectedRevision?: number };
    if (body.expectedRevision !== state.campaign.revision) return reply(409, { error: { code: "STALE_REVISION", message: "the campaign moved since it was read" } });
    if (act !== "promote" && act !== "reject") return reply(409, { error: { code: "IMP_PHASE", message: "not now" } });
    state.campaign = act === "promote" ? campaign({ phase: "PROMOTED", revision: 23, carrier: "later work", promotion: { from: PIN, to: CAND, door: "control", by: "person", at: "2026-10-30T01:00:00.000Z" } }) : campaign({ phase: "REJECTED", revision: 23, rejected: { reason: "PERSON_REJECTED", by: "person" }, ended: { outcome: "candidate-rejected", because: "a person rejected it", at: "2026-10-30T01:00:00.000Z" } });
    return reply(200, { result: { did: act === "promote" ? "PROMOTED" : "ENDED" }, version: 1, project: "repo-shop", campaign: state.campaign });
  };
  const save = (call: Call) => {
    const body = call.body as { settings: Record<string, unknown>; revision: string | null };
    if (body.revision !== state.settingsRev) return reply(409, { error: { code: "STALE_REVISION", message: "moved" } });
    Object.assign(state.values, body.settings);
    state.settingsRev = `rev-${Number(state.settingsRev?.slice(4) ?? 0) + 1}`;
    return reply(200, { saved: overview().settings });
  };
  const handle = (call: Call): Response | null => {
    if (!call.path.startsWith("/api/v1/projects/repo-shop/improvement") && call.path !== "/api/v1/projects") return null;
    state.calls.push(call);
    if (call.path === "/api/v1/projects") return reply(200, { projects: [{ key: "repo-shop", name: "shop", checkouts: [] }] });
    const rest = call.path.slice("/api/v1/projects/repo-shop/improvement".length);
    if (rest === "" && call.method === "GET") return reply(200, overview());
    if (rest === "/opportunities") return reply(200, { opportunities: [{ id: "opp-0123456789abcdef", subject: { kind: "skill", id: "release-x" }, pin: PIN, signal: "contract-violation", signature: ["notes"], runs: 4, sessions: 2, against: 0, eligible: true, check: "ELIGIBLE", because: "4 run(s) across 2 independent session(s)", cause: "definition", confidence: "high", campaign: state.campaign.id, environment: [], attribution: { bound: 4, of: 4, words: ["RUNTIME_BOUND"] } }] });
    if (rest === "/settings" && call.method === "PUT") return save(call);
    const m = /^\/campaigns\/([^/]+)(?:\/(promote|revert|reject))?$/.exec(rest);
    if (!m || m[1] !== state.campaign.id) return reply(404, { error: { code: "IMP_UNKNOWN", message: "no such campaign" } });
    return m[2] ? decide(call, m[2]) : reply(200, { version: 1, project: "repo-shop", campaign: state.campaign });
  };
  return { state, handle };
}
