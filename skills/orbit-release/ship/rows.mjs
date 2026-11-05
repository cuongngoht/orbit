// A ROW of a ship's cycle, as the benchmark is asked it and as its answer is held: the argument list for `run.mjs`
// (`ARGV`), and three ordered tables that judge what came back by reading the run's own room -- never the command's word
// alone. `ROW_VERDICT` holds a run to the tree, the harness, the case and the host it must have had; `CONTROL_RULES`
// holds each control a case declares, with one narrow rule for a known finding the ship repaired (ADR 0049);
// `REPAIR_CHECK` holds a verified candidate before anything of it is applied. First matching row wins; the last always
// matches.
//
//   argvOf(row, at) -> [args]          rowVerdict(f) -> verdict          controlVerdict(f) -> verdict
//   repairVerdict(f) -> verdict        identityOf(room) -> { basis, cli, model, costUsd, rounds, seconds, signature }
//   interruptedOf(report) -> boolean   (a round the controller never saw end, read back)
//   verdict: { state, code, says, outcome, cause, class, run, task, basis, cli, model, costUsd, costBasis, ... }
import { samePath } from "../../../src/frontend/local-clones.mjs";
import { matchesAny } from "./policy.mjs";

// ---- the argument lists -------------------------------------------------------------------------------------------------

const common = (at) => ["--source=head", `--tree=${at.tree}`, `--parent=${at.parent}`];

const hostFlags = (at) => [`--usd=${at.usd}`, ...(at.model ? [`--model=${at.model}`] : []), ...(at.credential ? [`--credential=${at.credential}`] : []), ...(at.caFile ? [`--ca-file=${at.caFile}`] : [])];

// A QA case plants its own variant; any other case is told which.
const variantFlag = (row) => (row.variant && row.kind !== "qa" ? [`--variant=${row.variant}`] : []);

export const ARGV = {
  verify: (row, at) => ["run", row.case, ...variantFlag(row), `--run-id=${at.runId}`, ...common(at)],
  controls: (row, at) => ["controls", row.case, `--run-id=${at.runId}`, ...common(at)],
  autonomous: (row, at) => ["run", row.case, ...variantFlag(row), ...(row.repair ? ["--repair"] : []), ...hostFlags(at), `--run-id=${at.runId}`, ...common(at)],
  repair: (row, at) => ["run", row.case, "--variant=real", "--repair", ...hostFlags(at), `--run-id=${at.runId}`, ...common(at)],
};

export const argvOf = (row, at) => ARGV[row.run](row, at);

// ---- what a run's room says of who carried it ---------------------------------------------------------------------------

// Every round a host carried: a source or engineering run's rounds, a QA run's one round.
const roundsOf = (report) => (Array.isArray(report?.rounds) ? report.rounds : report?.round ? [report.round] : []);

const hostsOf = (report) => roundsOf(report).map((r) => r.host).filter((h) => h && h.started !== false);

const reportedCost = (report) => (typeof report?.totals?.costUsd === "number" ? report.totals.costUsd : hostsOf(report).reduce((n, h) => (typeof h.costUsd === "number" ? (n ?? 0) + h.costUsd : n), null));

const secondsOf = (m, e) => (m?.at && e?.at ? Math.round((Date.parse(e.at) - Date.parse(m.at)) / 1000) : null);

export function identityOf(room) {
  const hosts = hostsOf(room.report);
  const cost = reportedCost(room.report);
  const versions = [...new Set(hosts.map((h) => h.version).filter(Boolean))];
  return { basis: room.report?.hostBasis ?? null, cli: versions.length ? versions.join(",") : null, image: room.manifest?.images?.claudeCode ?? null, model: hosts.map((h) => h.model).find(Boolean) ?? null, costUsd: cost, costBasis: cost === null ? null : "REPORTED", rounds: hosts.length, seconds: secondsOf(room.manifest, room.ending), signature: (room.report?.attempts ?? []).map((a) => a.signature).filter(Boolean).at(-1) ?? null };
}

// A host the release accepts: the coding host, which said which Claude Code it ran -- the very one the image pins --
// and which model.
const realHost = (id) => id.basis === "coding-host" && Boolean(id.model) && Boolean(id.cli) && id.cli === id.image;

// A round the controller never saw end -- a restart killed it, and what it left was read back -- as the run's own report
// says it of each round (`interrupted`: the round's action closed as interrupted, with no evidence of its own). Read off
// that record alone: never a timestamp, never a guess from what a round is missing.
export const interruptedOf = (report) => roundsOf(report).some((r) => r?.interrupted === true);

// What a run says of a host other than the one a release accepts: another basis, or a Claude Code version beside the one
// the image pins. A round nobody saw end says nothing at all -- no host, never another one.
const anotherHost = (room) => ((id) => id.basis !== "coding-host" || hostsOf(room.report).some((h) => h.version && h.version !== id.image))(identityOf(room));

// ---- ROW_VERDICT ----------------------------------------------------------------------------------------------------------

// One directory however it is spelled: on Windows a short name (RUNNER~1) and the long one git answers are one
// directory (samePath); a run whose manifest names no tree is never this cycle's.
const same = (a, b) => Boolean(a && b) && samePath(a, b);

const outcomeOf = (f) => f.room?.ending?.outcome ?? f.answer?.json?.outcome ?? null;

const PERSON_HELD = ["PAUSED", "CANCELLED"];

// f: { row, answer: { code, json, err }, room: { manifest, ending, report }, cycle: { commit, tree, digest }, ship: {
// harness, caseDigest } }
export const ROW_VERDICT = [
  { code: "UNSETTLED", state: "UNSETTLED", when: (f) => !f.room?.ending && !f.answer?.json && f.answer?.code !== 2 && f.answer?.code !== 3, says: () => "the run did not end: it is read back, never sent again" },
  { code: "REFUSED", state: "REFUSED", when: (f) => (!f.room?.ending && f.answer?.code === 2) || ["BENCHMARK_INVALID", "REFUSED"].includes(outcomeOf(f)), says: (f) => f.room?.ending?.summary ?? f.answer?.err ?? "the benchmark refused the run" },
  { code: "BLOCKED", state: "BLOCKED", when: (f) => f.answer?.code === 3 || outcomeOf(f) === "BLOCKED", says: (f) => f.room?.ending?.summary ?? f.answer?.err ?? "the environment blocked the run" },
  { code: "HELD_BY_PERSON", state: "HELD_BY_PERSON", when: (f) => PERSON_HELD.includes(outcomeOf(f)), says: (f) => `a person held the run (${outcomeOf(f)})` },
  { code: "WRONG_TREE", state: "UNTRUSTED", when: (f) => f.room?.manifest?.source?.commit !== f.cycle.commit || !same(f.room?.manifest?.source?.repo, f.cycle.tree) || (f.cycle.digest !== null && f.room?.manifest?.source?.digest !== f.cycle.digest), says: (f) => `the run froze ${f.room?.manifest?.source?.commit ?? "no"} commit at ${f.room?.manifest?.source?.repo ?? "nowhere"}, not this cycle's release commit ${f.cycle.commit}` },
  { code: "HARNESS_MOVED", state: "UNTRUSTED", when: (f) => f.ship.harness !== null && f.room?.manifest?.benchmark?.harness !== f.ship.harness, says: () => "another harness judged this run than the one this ship began with" },
  { code: "CASE_MOVED", state: "UNTRUSTED", when: (f) => f.ship.caseDigest !== null && f.room?.manifest?.benchmark?.digest !== f.ship.caseDigest, says: () => "the case this run froze is not the case this ship first ran" },
  { code: "LEAK", state: "UNTRUSTED", when: (f) => (f.room?.report?.leaks ?? []).length > 0, says: (f) => `the credential was found in ${f.room.report.leaks.length} file(s) of the run's room, and masked: a person looks before a release` },
  // A model-carried run a restart interrupted lost its own evidence: what its host was is unknown, so whatever it came
  // to is never evidence -- and never the model's miss either, so it is run again, fresh (DIAGNOSE). A run that says
  // another host is WRONG_HOST below, interrupted or not.
  { code: "INTERRUPTED", state: "INTERRUPTED", when: (f) => f.row.autonomous && interruptedOf(f.room?.report) && !anotherHost(f.room), says: (f) => `a round of its run was interrupted before the controller saw it end, and was read back (${outcomeOf(f) ?? "no outcome"}): no host identity of its own survives it, so it is never evidence` },
  { code: "UNEXPECTED", state: "FAILED", when: (f) => !(f.row.expect ?? []).includes(outcomeOf(f)), says: (f) => f.room?.ending?.summary ?? `${outcomeOf(f)}, where ${(f.row.expect ?? []).join(" or ")} is required` },
  { code: "WRONG_HOST", state: "UNTRUSTED", when: (f) => f.row.autonomous && !realHost(identityOf(f.room)), says: (f) => ((id) => `a model-carried row needs the coding host with its Claude Code identity; this run says basis ${id.basis ?? "unknown"}, Claude Code ${id.cli ?? "unknown"} (image ${id.image ?? "unknown"}), model ${id.model ?? "unknown"}`)(identityOf(f.room)) },
  { code: "HELD", state: "HELD", when: () => true, says: (f) => `${outcomeOf(f)} on ${f.cycle.commit.slice(0, 12)}` },
];

const verdictFrom = (table, f) => ((r) => ({ state: r.state, code: r.code, says: r.says(f), outcome: outcomeOf(f), cause: f.room?.ending?.cause ?? null, class: f.room?.ending?.class ?? null, run: f.room?.manifest?.run ?? null, task: f.room?.manifest?.task ?? null, digest: f.room?.manifest?.source?.digest ?? null, harness: f.room?.manifest?.benchmark?.harness ?? null, caseDigest: f.room?.manifest?.benchmark?.digest ?? null, ...(f.room?.manifest ? identityOf(f.room) : {}) }))(table.find((x) => x.when(f)));

export const rowVerdict = (f) => verdictFrom(ROW_VERDICT, f);

// ---- CONTROL_RULES --------------------------------------------------------------------------------------------------------

// What a control on a known finding's `real` variant may expect only while the finding stands: the case passing, or a
// repair of it. Once the real source passes the same verifier on the same digest, such a control has nothing left to
// prove -- it is SUPERSEDED: reported, never counted as held, and the case is a person's to bring up to date.
const PRESUPPOSE = ["PASS", "REPAIRED_VERIFIED", "REPAIR_REJECTED", "NO_PROGRESS"];

export const CONTROL_RULES = [
  { id: "MATCHED", when: (k) => k.matched === true, held: true },
  { id: "SUPERSEDED", when: (k, f) => f.case?.baseline === "FAIL" && k.variant === "real" && PRESUPPOSE.includes(k.expect) && f.realHeld === true, held: true, superseded: true },
  { id: "DRIFTED", when: (k) => k.got === "DRIFTED", held: false, class: "BENCHMARK_DEFECT" },
  { id: "MISMATCHED", when: () => true, held: false, class: "VERIFIER_DEFECT" },
];

const ruled = (f) => (k) => ((r) => ({ id: k.id, rule: r.id, held: r.held, superseded: r.superseded === true, class: r.class ?? null, expect: k.expect, got: k.got }))(CONTROL_RULES.find((r) => r.when(k, f)));

// Every room a control set kept: the set's own (a source case's verifier controls) and each run a control carried.
export const controlRuns = (json) => [...new Set([...String(json?.run ?? "").split(/\s+/), ...(json?.rows ?? []).map((k) => k.run)].filter((r) => /^bnr-[a-f0-9]{12}$/.test(String(r))))];

// f: { row, answer, rooms: [{ manifest }], cycle, case, realHeld }
export const CONTROL_VERDICT = [
  { code: "REFUSED", state: "REFUSED", when: (f) => !f.answer?.json && f.answer?.code === 2, says: (f) => f.answer?.err ?? "the benchmark refused the controls" },
  { code: "BLOCKED", state: "BLOCKED", when: (f) => !f.answer?.json, says: (f) => f.answer?.err ?? "the controls could not run here" },
  { code: "WRONG_TREE", state: "UNTRUSTED", when: (f) => f.rooms.length === 0 || f.rooms.some((r) => r.manifest?.source?.commit !== f.cycle.commit), says: (f) => `a control ran on another source than this cycle's release commit ${f.cycle.commit}` },
  { code: "NOT_HELD", state: "FAILED", when: (f) => f.ruled.some((k) => !k.held), says: (f) => `controls not held: ${f.ruled.filter((k) => !k.held).map((k) => `${k.id} (${k.rule}: expected ${k.expect}, got ${k.got})`).join("; ")}` },
  { code: "HELD", state: "HELD", when: () => true, says: (f) => `${f.ruled.length} control(s) held${f.ruled.some((k) => k.superseded) ? `; superseded: ${f.ruled.filter((k) => k.superseded).map((k) => k.id).join(", ")} -- ${f.row.case} needs a person's update (baseline PASS, a controlled-fault variant planting the old defect)` : ""}` },
];

export function controlVerdict(f) {
  const g = { ...f, ruled: (f.answer?.json?.rows ?? []).map(ruled(f)) };
  const r = CONTROL_VERDICT.find((x) => x.when(g));
  return { state: r.state, code: r.code, says: r.says(g), outcome: g.answer?.json ? (g.ruled.every((k) => k.held) ? "HELD" : "NOT_HELD") : null, class: g.ruled.find((k) => !k.held)?.class ?? null, cause: null, run: controlRuns(g.answer?.json).join(" ") || null, controls: g.ruled, superseded: g.ruled.filter((k) => k.superseded).map((k) => k.id) };
}

// ---- REPAIR_CHECK ---------------------------------------------------------------------------------------------------------

// What a TEST is, wherever this repository keeps one -- the benchmark's own rule, said again here because the ship
// checks a candidate a second time and never imports the benchmark.
const TEST_PATH = /^((satellite|control-server)\/)?test\//;

// f: { row, answer, room, verified, patch: { digest, touched: [{ path, added, removed, existed }] }, cycle, ship, policy,
// case }
// A repair run a restart interrupted (its round read back by `resume`, no host identity of its own) is INTERRUPTED before
// anything is said of its candidate -- whatever the verifier made of it: never integrated, since only the coding host's
// own repair is; never the model's miss, so it spends no repair attempt and runs again as a new repair (machine.mjs).
export const REPAIR_CHECK = [
  ...ROW_VERDICT.slice(0, 7),
  { code: "INTERRUPTED", state: "INTERRUPTED", when: (f) => interruptedOf(f.room?.report) && !anotherHost(f.room), says: (f) => `a round of the repair was interrupted before the controller saw it end, and was read back (${outcomeOf(f) ?? "no outcome"}): no host identity of its own survives it, so its candidate is never integrated -- a new repair runs, spending no attempt` },
  { code: "NOT_VERIFIED", state: "REJECTED", when: (f) => outcomeOf(f) !== "REPAIRED_VERIFIED", says: (f) => f.room?.ending?.summary ?? `${outcomeOf(f)}: the verifier did not pass a candidate` },
  { code: "NO_VERIFIED_RECORD", state: "REFUSED_BY_SHIP", when: (f) => !f.verified || f.verified.run !== f.room.manifest.run || f.verified.case?.id !== f.row.case || f.verified.variant !== "real" || f.verified.source?.commit !== f.cycle.commit, says: () => "verified.json is missing, or names another run, case, variant or source than this repair" },
  { code: "PATCH_DIGEST", state: "REFUSED_BY_SHIP", when: (f) => !f.patch || f.patch.digest !== f.verified.candidate?.patchDigest, says: () => "the candidate patch is not the one the verifier passed (its digest differs)" },
  { code: "WRONG_HOST", state: "UNTRUSTED", when: (f) => !realHost(identityOf(f.room)) || f.verified.host?.basis !== "coding-host", says: () => "a repair carried by anything but the coding host, with its Claude Code identity, is never integrated" },
  { code: "NOTHING_TOUCHED", state: "REFUSED_BY_SHIP", when: (f) => f.patch.touched.length === 0, says: () => "the patch touches nothing" },
  { code: "OUT_OF_SCOPE", state: "REFUSED_BY_SHIP", when: (f) => f.patch.touched.some((t) => !matchesAny(f.case?.scope?.allow ?? [], t.path)), says: (f) => `outside the case's scope: ${f.patch.touched.filter((t) => !matchesAny(f.case?.scope?.allow ?? [], t.path)).map((t) => t.path).join(", ")}` },
  { code: "PROTECTED", state: "REFUSED_BY_SHIP", when: (f) => f.patch.touched.some((t) => matchesAny(f.policy.protected, t.path)), says: (f) => `a protected path -- the harness, a check, the release itself: ${f.patch.touched.filter((t) => matchesAny(f.policy.protected, t.path)).map((t) => t.path).join(", ")}` },
  { code: "TEST_WEAKENED", state: "REFUSED_BY_SHIP", when: (f) => f.patch.touched.some((t) => TEST_PATH.test(t.path) && t.existed && t.removed > 0), says: (f) => `an existing test loses lines: ${f.patch.touched.filter((t) => TEST_PATH.test(t.path) && t.existed && t.removed > 0).map((t) => t.path).join(", ")}` },
  { code: "VERIFIED", state: "VERIFIED", when: () => true, says: (f) => `REPAIRED_VERIFIED: ${f.patch.touched.length} path(s), patch ${f.patch.digest.slice(0, 12)}` },
];

export const repairVerdict = (f) => ({ ...verdictFrom(REPAIR_CHECK, f), touched: f.patch?.touched ?? [], patchDigest: f.patch?.digest ?? null });
