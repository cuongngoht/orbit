// VERIFYING a tree -- the subject as it was frozen, or a candidate a round left -- in containers that share nothing
// with a runner: no network, no credential, no model, a fresh container for every part, the tree written by the
// controller itself and mounted from where it was written. Three parts, each its own evidence:
//
//   hidden   the case's probe, the subject's code imported in a container of its own, answering the spec's inputs;
//            judged HERE, by the frozen spec and the harness judge, which never import the subject
//   gates    the repository's own checks the case names, each in a fresh copy of the tree with every EXISTING test
//            file restored to the subject's own -- a repair that edited a test is still held to the test it edited;
//            exit codes are read from docker, and a gate that ran fewer tests than the subject's did failed
//   agent    a candidate's own regression tests: they must fail on the subject and pass on the candidate
//
// Time and memory are judged by whose tree it is. When the SUBJECT's containers run out of either, the verifier could
// not run as declared (an infrastructure fact). When a CANDIDATE's do, that is the candidate's own failure: a candidate
// that hangs or bloats is rejected by name (`hidden:probe:TIMEOUT`), never excused as the environment -- and once its
// hidden checks did not answer, its gates and own tests are not run, because it is already rejected.
//
//   verified(ctx, label, entries, o) -> { label, digest, hidden, gates, agent, failures, signature, complete, problem,
//                                         problemEnds, skipped }      o: { baseline, agentTests, beforeGates, between,
//                                                                          candidate }
//   tapCounts(text) -> { tests, pass, fail }      gateEntries(entries, baseline) -> entries
import { realpathSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { isTest } from "./candidate.mjs";
import { judgedAll, probeInput } from "./judge.mjs";
import { ranContainer, specFor } from "../core/docker.mjs";
import { signatureOf } from "./decide.mjs";
import { madeDir } from "../core/room.mjs";
import { treeDigestOf, writtenTree } from "../core/freeze.mjs";

const count = (re, text) => ((m) => (m ? Number(m[1]) : null))(re.exec(String(text ?? "")));

export const tapCounts = (text) => ({ tests: count(/^# tests (\d+)/m, text), pass: count(/^# pass (\d+)/m, text), fail: count(/^# fail (\d+)/m, text) });

// A test, by the one rule SCOPE holds a candidate to (candidate.mjs TEST_PATH).
const isTestRel = (rel) => isTest(rel);

// The tree a gate runs on: the entries, with every test file the subject already had put back as the subject had it.
export function gateEntries(entries, baseline) {
  const old = new Map(baseline.filter((e) => isTestRel(e.rel)).map((e) => [e.rel, e]));
  return [...entries.filter((e) => !old.has(e.rel)), ...old.values()];
}

export const overlaidFiles = (base, entries, rels) => [...base.filter((e) => !rels.includes(e.rel)), ...entries.filter((e) => rels.includes(e.rel))];

// ---- one container of the verifier ---------------------------------------------------------------------------------

const box = (ctx) => ({ limits: { cpus: ctx.limits.cpus, memoryMb: ctx.limits.memoryMb, pids: ctx.limits.pids }, cpuset: ctx.cpuset, user: ctx.user, image: ctx.images.verifier });

const forbidden = (ctx) => [homedir(), ctx.storeBase, ctx.repoRoot].filter(Boolean);

const attestFor = (ctx, target) => ({ network: "none", forbidden: forbidden(ctx), pluginTarget: target, imageEnv: ctx.imageEnv });

const running = (ctx, role, spec, input, target) => ranContainer(spec, ctx.deps, { input, timeoutMs: ctx.limits.seconds * 1000, outputBytes: 16 * 1024 * 1024, attest: attestFor(ctx, target) });

const counter = (ctx) => (ctx.counter = (ctx.counter ?? 0) + 1);

// A container's end, as the verifier reads it: refused, out of time or memory, or how it exited.
const endWord = (r) => (r.refused ? "REFUSED" : r.timedOut ? "TIMEOUT" : r.oom ? "OOM" : r.exit === null ? "NO_EXIT" : `EXIT_${r.exit}`);

async function probed(ctx, tree, cases) {
  const spec = specFor("probe", ctx.run, { ...box(ctx), n: counter(ctx), argv: ["node", "/probe/probe.mjs", "/in/subject"], mounts: [{ source: tree, target: "/in/subject", readOnly: true }, { source: ctx.probeFile, target: "/probe/probe.mjs", readOnly: true }], attestRole: "worker", tmpMb: 256 });
  const r = await running(ctx, "probe", spec, probeInput(cases), "/in/subject");
  const judged = r.refused || r.timedOut || r.oom ? null : judgedAll(cases, r.out, ctx.spec);
  return { end: endWord(r), attested: r.attested, checks: judged?.checks ?? [], error: judged?.error ?? null, ran: Boolean(judged) };
}

async function containerRun(ctx, role, entries, argv, label) {
  const dir = realpathSync(madeDir(ctx.room, "scratch", label));
  writtenTree(dir, entries);
  const spec = specFor(role, ctx.run, { ...box(ctx), n: counter(ctx), argv, workdir: "/work/tree", mounts: [{ source: dir, target: "/work/tree", readOnly: false }], env: { names: [], values: { HOME: "/tmp", TMPDIR: "/tmp" } }, tmpMb: 1024 });
  const r = await running(ctx, role, spec, "", null);
  return { end: endWord(r), exit: r.exit, timedOut: Boolean(r.timedOut), oom: Boolean(r.oom), refused: r.refused ?? null, out: r.out ?? "", attested: r.attested, tap: tapCounts(r.out) };
}

// ---- the parts ---------------------------------------------------------------------------------------------------------

const gateOk = (g, r, before) => r.end === "EXIT_0" && (!g.stdout || new RegExp(g.stdout, "m").test(r.out)) && (r.tap.fail ?? 0) === 0 && (before?.tap?.tests == null || r.tap.tests === before.tap.tests);

const gateWhy = (g, r, before) => (r.end !== "EXIT_0" ? `it ended ${r.end}` : g.stdout && !new RegExp(g.stdout, "m").test(r.out) ? `its output does not say ${g.stdout}` : before?.tap?.tests != null && r.tap.tests !== before.tap.tests ? `it ran ${r.tap.tests} test(s) where the subject ran ${before.tap.tests}` : "its tests failed");

async function gated(ctx, label, entries, baseline, before) {
  const out = [];
  for (const g of ctx.case.checks.gates) out.push(((r) => ({ id: g.id, ok: gateOk(g, r, before?.[g.id]), why: gateOk(g, r, before?.[g.id]) ? null : gateWhy(g, r, before?.[g.id]), end: r.end, tap: r.tap, attested: r.attested, tail: r.out.slice(-1500) }))(await containerRun(ctx, "gate", gateEntries(entries, baseline), g.argv, `${label}/gate-${g.id}`)));
  return out;
}

const AGENT_ARGV = (rels) => ["node", "--test", "--test-reporter=tap", ...rels];

async function agentProven(ctx, label, entries, baseline, rels) {
  const before = await containerRun(ctx, "agent", overlaidFiles(baseline, entries, rels), AGENT_ARGV(rels), `${label}/agent-before`);
  const after = await containerRun(ctx, "agent", entries, AGENT_ARGV(rels), `${label}/agent-after`);
  return { rels, before: { end: before.end, tap: before.tap, failed: before.end !== "EXIT_0" && !before.refused && !before.timedOut }, after: { end: after.end, tap: after.tap, ok: after.end === "EXIT_0" && (after.tap.tests ?? 0) > 0 && (after.tap.fail ?? 0) === 0 }, attested: [...before.attested, ...after.attested] };
}

// ---- the whole verification --------------------------------------------------------------------------------------------

const PROBE_SOURCE = ["IMPORT", "PROBE_UNREADABLE"];

// How a container ends when it ran out of time or memory -- the subject's environment, or a candidate's own failure.
export const RESOURCE_ENDS = ["TIMEOUT", "OOM"];

// The ends that keep a verification from being one, by whose tree it is.
export const PROBLEM_ENDS = { subject: ["REFUSED", "TIMEOUT", "OOM", "NO_EXIT"], candidate: ["REFUSED", "NO_EXIT"] };

const probeEnded = (v) => (RESOURCE_ENDS.includes(v.hidden.end) ? [`hidden:probe:${v.hidden.end}`] : []);

const failuresOf = (v) => [...v.hidden.checks.filter((c) => !c.ok).map((c) => `hidden:${c.id}`), ...(v.hidden.error ? [`hidden:probe:${v.hidden.error.code}`] : []), ...probeEnded(v), ...v.gates.filter((g) => !g.ok).map((g) => `gate:${g.id}`), ...(v.agent && !v.agent.before.failed ? ["agent:passes-before"] : []), ...(v.agent && !v.agent.after.ok ? ["agent:fails-after"] : [])];

const containersOf = (v) => [{ end: v.hidden.end }, ...v.gates, ...(v.agent ? [v.agent.before, v.agent.after] : [])];

// What kept a verification from being one -- never a test that failed: the ends, by whose tree it was.
const problemEndsOf = (v, side) => [...new Set(containersOf(v).map((c) => c.end).filter((end) => PROBLEM_ENDS[side].includes(end)))];

const problemOf = (ends) => (ends.length ? `the verifier could not run as declared (${ends.join(", ")})` : null);

// The three parts, in order: the hidden checks first (TESTING), then -- the caller told when -- the gates and the
// candidate's own test (REGRESSION). A candidate whose hidden checks did not answer in time goes no further.
async function parts(ctx, label, entries, o) {
  const tree = realpathSync(madeDir(ctx.room, "scratch", label, "tree"));
  writtenTree(tree, entries);
  const hidden = await probed(ctx, tree, ctx.cases);
  if (o.between) o.between();
  return (o.candidate && RESOURCE_ENDS.includes(hidden.end) ? unanswered : answered)(ctx, label, entries, o, { label, digest: treeDigestOf(entries), mounted: tree, hidden });
}

const unanswered = async (ctx, label, entries, o, base) => ({ ...base, gates: [], agent: null, skipped: `the hidden checks did not answer (${base.hidden.end}): the candidate is rejected, and its gates and its own tests are not run` });

const answered = async (ctx, label, entries, o, base) => ({ ...base, gates: await gated(ctx, label, entries, o.baseline ?? entries, o.beforeGates ?? null), agent: o.agentTests?.length ? await agentProven(ctx, label, entries, o.baseline, o.agentTests) : null, skipped: null });

export async function verified(ctx, label, entries, o = {}) {
  const v = await parts(ctx, label, entries, o);
  const failures = failuresOf(v);
  const ends = problemEndsOf(v, o.candidate ? "candidate" : "subject");
  return { ...v, failures, signature: signatureOf(failures), hiddenFailed: v.hidden.checks.filter((c) => !c.ok).length, gatesFailed: v.gates.filter((g) => !g.ok).length, missingExports: v.hidden.error?.code === "MISSING_EXPORT" ? v.hidden.error.names : [], probeBroken: PROBE_SOURCE.includes(v.hidden.error?.code), problem: problemOf(ends), problemEnds: ends, complete: !ends.length && (v.hidden.ran || RESOURCE_ENDS.includes(v.hidden.end)) };
}
