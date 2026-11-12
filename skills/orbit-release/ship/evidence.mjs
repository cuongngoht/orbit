// THE PUBLISH GATE (`ship.mjs --evidence --evaluation=<record.json>`, ADR 0057): whether the commit at HEAD may be
// published. It trusts nothing as written: an ordered table (`PUBLISH`, the first row that fails decides) holds this
// checkout and the independent evaluator's record to what can be read again HERE -- the fast tier run on this very tree,
// the record's shape, the pre-registration it names (digest), the archive of every release-candidate arm's commit
// against the archive of HEAD (content digests, computed here with artifact.mjs: a commit that touches only
// export-ignored paths, such as the evaluator's results, keeps the evidence, and any other voids it), every
// pre-registered held-out run present with an outcome word, and the pre-registered verdict worked out again from those
// words. Only PUBLISHABLE exits 0; nothing here tags, pushes or publishes. Each row says what it read and the one thing
// a person does next.
//
//   factsOf(ports) -> g (every fact a thunk, computed once, only when a row asks)
//   ports: { dirty() -> [path], fastTier() -> [gate row], version() -> string, recordText() -> { file, text } | null,
//            read(rel) -> text | null, archive(rev) -> Buffer (throws), given() -> Buffer | null }
//   publishableOf(g) -> { publishable, code, says, reads, next, comparisons, verdict }      PUBLISH
//   verdictOf(runs, a, b, rule) -> comparison      expectedRuns(prereg) -> [{ arm, task, trial }]
import { canonicalJson, sha } from "../../../src/hash.mjs";
import { shippable } from "../gates.mjs";
import { artifactOf } from "./artifact.mjs";

export const RECORD_KIND = "orbit-evaluation-record";

const memo = (f) => {
  const box = {};
  return () => ("v" in box ? box.v : (box.v = f()));
};

const parsed = (text) => {
  try { return JSON.parse(text); }
  catch { return undefined; }
};

// ---- the record ---------------------------------------------------------------------------------------------------------

const HEX = /^[0-9a-f]{64}$/;
const COMMIT = /^[0-9a-f]{40}$/;

// A path inside this checkout, said the one way: relative, '/' separators, no way up.
const insidePath = (p) => typeof p === "string" && /^[\w.\-/]+$/.test(p) && !p.startsWith("/") && !p.split("/").includes("..");

const runKey = (r) => `${r.arm}\u0000${r.task}\u0000${r.trial}\u0000${r.track ?? ""}`;

const RUN_FIELDS = (r) => r && typeof r.arm === "string" && typeof r.task === "string" && Number.isInteger(r.trial) && typeof r.word === "string";

// What the evaluator's `record` writes (evaluator/lib/record.mjs), each field said by what is wrong with it.
const SHAPE = [
  { says: "schema is not 1", bad: (r) => r.schema !== 1 },
  { says: `kind is not ${RECORD_KIND}`, bad: (r) => r.kind !== RECORD_KIND },
  { says: "release names no version", bad: (r) => typeof r.release !== "string" || !r.release },
  { says: "prereg names no file inside the repository and a sha256 digest", bad: (r) => !insidePath(r.prereg?.file) || !HEX.test(r.prereg?.digest ?? "") },
  { says: "arms is not an object of arms", bad: (r) => !r.arms || typeof r.arms !== "object" || Array.isArray(r.arms) },
  { says: "runs is not a list of { arm, task, trial, word }", bad: (r) => !Array.isArray(r.runs) || !r.runs.every(RUN_FIELDS) },
  { says: "a run names an arm the record does not declare", bad: (r) => r.runs.some((x) => !r.arms[x.arm]) },
  { says: "a run is listed twice", bad: (r) => new Set(r.runs.map(runKey)).size !== r.runs.length },
  { says: "comparisons is not a list", bad: (r) => !Array.isArray(r.comparisons) },
];

export const shapeProblems = (r) => (r && typeof r === "object" ? firstBad(r) : ["it is not a JSON object"]);

// In order, and only up to the first: a later rule reads what an earlier one held.
const firstBad = (r) => ((hit) => (hit ? [hit.says] : []))(SHAPE.find((s) => s.bad(r)));

// ---- the pre-registration -------------------------------------------------------------------------------------------------

const HELD_OUT = "heldOut";

const top = (list, n) => (list ?? []).slice(0, n).map((x) => x.id);

// The held-out tasks, as the pre-registration fixes them: the top `counts` of its SWE-bench order, then of its packs.
export const heldOutTasks = (p) => ((n) => (n ? [...top(p.order?.[HELD_OUT]?.swebench, n.swebench).map((id) => `swebench:${id}`), ...top(p.order?.[HELD_OUT]?.packs, n.packs).map((id) => `pack:${id}`)] : []))(fixedCounts(p));

const fixedCounts = (p) => ((n) => (Number.isInteger(n?.swebench) && Number.isInteger(n?.packs) ? n : null))(p.counts?.[HELD_OUT]);

// Every run the pre-registration owes on the held-out set: each arm of each held-out phase on each held-out task, once.
export const expectedRuns = (p) => (p.phases ?? []).filter((ph) => ph.set === HELD_OUT).flatMap((ph) => ph.arms.flatMap((arm) => heldOutTasks(p).map((task) => ({ arm, task, trial: 1 }))));

const gating = (p) => (p.comparisons ?? []).filter((c) => c.gate !== false && c.set === HELD_OUT);

// An arm the release's verdict rests on: named by a comparison the pre-registration does not mark `gate: false`. Only
// an arm the verdict does not rest on may be NOT_RUN (the pre-registration's own allowance, e.g. an arm whose credential
// was never supplied).
const gatingArms = (p) => new Set(gating(p).flatMap((c) => [c.a, c.b]));

// The arms registered with no revision: they run at the release candidate's commit, named when their campaign begins.
export const candidateArms = (p) => Object.entries(p.arms ?? {}).filter(([, a]) => a.rev === null).map(([id]) => id);

const ownedBy = (p, rec) => (want) => rec.runs.find((r) => !r.track && r.arm === want.arm && r.task === want.task && r.trial === want.trial);

const worded = (p, run) => Boolean(run) && ((p.outcomes?.words ?? []).includes(run.word) || (run.word === "NOT_RUN" && !gatingArms(p).has(run.arm)));

// What the record owes and does not hold: a run absent, still pending, or NOT_RUN where the verdict rests on it.
export const missingRuns = (p, rec) => (fixedCounts(p) ? expectedRuns(p).filter((want) => !worded(p, ownedBy(p, rec)(want))).map((w) => `${w.arm} on ${w.task}`) : ["the pre-registration's held-out counts are not fixed"]);

// ---- the verdict, worked out again ----------------------------------------------------------------------------------------

const median = (xs) => ((v) => (v.length ? (v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2) : null))(xs.filter((x) => typeof x === "number" && Number.isFinite(x)).sort((a, b) => a - b));

const pairedTasks = (runs, a, b, rule) => [...new Set(runs.map((r) => r.task))].filter((t) => rule.rated.includes(wordOf(runs, a, t)) && rule.rated.includes(wordOf(runs, b, t)));

const wordOf = (runs, arm, task) => runs.find((r) => r.arm === arm && r.task === task && !r.track)?.word ?? null;

const runOf = (runs, arm, task) => runs.find((r) => r.arm === arm && r.task === task && !r.track);

const judged = (n, rule) => (n.paired < rule.minPaired ? "INCONCLUSIVE" : n.d <= -rule.margin || n.reg >= rule.margin ? "REGRESSED" : n.d >= rule.margin ? "IMPROVED" : n.d === 0 ? "NO_DIFFERENCE" : "INCONCLUSIVE");

const countOf = (runs, tasks, arm, w) => tasks.filter((t) => wordOf(runs, arm, t) === w).length;

const perArm = (runs, tasks, a, b, f) => ({ [a]: f(a), [b]: f(b) });

// One comparison of arm A against arm B over the held-out tasks both have a rated word on, by the registered rule
// (the evaluator's verdictOf, read from the same pre-registration): resolved difference, regressions and FALSE_DONE.
export function verdictOf(runs, a, b, rule) {
  const tasks = pairedTasks(runs, a, b, rule);
  const n = (arm, w) => countOf(runs, tasks, arm, w);
  const facts = { paired: tasks.length, d: n(a, "RESOLVED") - n(b, "RESOLVED"), reg: n(a, "REGRESSED") - n(b, "REGRESSED") };
  return { a, b, paired: facts.paired, resolved: perArm(runs, tasks, a, b, (x) => n(x, "RESOLVED")), regressed: perArm(runs, tasks, a, b, (x) => n(x, "REGRESSED")), falseDone: perArm(runs, tasks, a, b, (x) => n(x, "FALSE_DONE")), difference: facts.d, medianCostUsd: perArm(runs, tasks, a, b, (x) => median(tasks.map((t) => runOf(runs, x, t)?.costUsd))), medianMinutes: perArm(runs, tasks, a, b, (x) => median(tasks.map((t) => runOf(runs, x, t)?.minutes))), verdict: judged(facts, rule) };
}

const heldOutRuns = (p, rec) => ((tasks) => rec.runs.filter((r) => !r.track && tasks.has(r.task)))(new Set(heldOutTasks(p)));

export const comparisonsOf = (p, rec) => (p.comparisons ?? []).filter((c) => c.set === HELD_OUT).map((c) => ({ ...verdictOf(heldOutRuns(p, rec), c.a, c.b, p.verdictRule), gate: c.gate !== false }));

// The release's verdict over the comparisons it rests on: REGRESSED if any is, IMPROVED or NO_DIFFERENCE only if all
// are, else INCONCLUSIVE.
export const overallOf = (vs) => (vs.includes("REGRESSED") ? "REGRESSED" : vs.length && vs.every((v) => v === "IMPROVED") ? "IMPROVED" : vs.length && vs.every((v) => v === "NO_DIFFERENCE") ? "NO_DIFFERENCE" : "INCONCLUSIVE");

const SAID = (c) => `${c.a} ${c.b} ${c.verdict} ${c.paired} ${c.difference}`;

// Where the record's own comparisons say something its runs do not: a record is the evaluator's arithmetic, and the
// gate does the arithmetic again.
const disagreements = (p, rec) => comparisonsOf(p, rec).filter((c) => !rec.comparisons.some((r) => SAID(r) === SAID(c))).map((c) => `${c.a} against ${c.b}`);

// ---- the facts, each computed once and only when a row asks ---------------------------------------------------------------

const recordOf = (ports) => ((got) => (!got ? { why: "no --evaluation=<record.json> was given" } : got.text === null ? { file: got.file, why: `${got.file} cannot be read` } : ((v) => (v === undefined ? { file: got.file, why: `${got.file} is not JSON` } : { file: got.file, value: v }))(parsed(got.text))))(ports.recordText());

const preregOf = (ports, rec) => ((text) => ((v) => (v === undefined ? null : { value: v, digest: sha(canonicalJson(v)) }))(text === null ? undefined : parsed(text)))(ports.read(rec.prereg.file));

const archived = (ports, rev) => {
  try { return { rev, ...artifactOf(ports.archive(rev)) }; }
  catch (e) { return { rev, error: e.message }; }
};

const candidatesOf = (g) => candidateArms(g.prereg().value).filter((arm) => g.record().value.arms[arm]).map((arm) => ({ arm, commit: g.record().value.arms[arm].commit ?? null }));

export function factsOf(ports) {
  const g = { dirty: memo(ports.dirty), fastTier: memo(ports.fastTier), version: memo(ports.version), record: memo(() => recordOf(ports)), head: memo(() => archived(ports, "HEAD")) };
  g.prereg = memo(() => preregOf(ports, g.record().value));
  g.candidates = memo(() => candidatesOf(g).map((c) => ({ ...c, artifact: COMMIT.test(c.commit ?? "") ? archived(ports, c.commit) : { error: "the record names no commit for it" } })));
  g.given = memo(() => ((buf) => (buf ? artifactOf(buf) : null))(ports.given()));
  return g;
}

// ---- the table -------------------------------------------------------------------------------------------------------------

const listed = (xs, n = 5) => `${xs.slice(0, n).join(", ")}${xs.length > n ? `, … (${xs.length} in all)` : ""}`;

const failedGates = (g) => g.fastTier().filter((r) => !r.ok && r.required !== false).map((r) => r.name);

const unarchived = (g) => g.candidates().filter((c) => c.artifact.error);

const moved = (g) => g.candidates().filter((c) => c.artifact.content !== g.head().content);

const gatingVerdicts = (g) => comparisonsOf(g.prereg().value, g.record().value).filter((c) => c.gate).map((c) => c.verdict);

const RECORD_NEXT = "node evaluator/cli.mjs record --prereg=evaluator/prereg/<release>.json --campaign=<the held-out campaigns> --out=<file>, then ask again with --evaluation=<file>";

export const PUBLISH = [
  { code: "DIRTY", reads: "git status of this checkout", when: (g) => g.dirty().length > 0, says: (g) => `uncommitted or untracked files (${listed(g.dirty())}): what is published is the committed tree alone`, next: "commit or remove them, then ask again" },
  { code: "FAST_TIER", reads: "the fast tier (what --ci runs) on this tree", when: (g) => !shippable(g.fastTier()), says: (g) => `the fast tier did not hold on this tree: ${listed(failedGates(g))}`, next: "node skills/orbit-release/ship.mjs --ci, and fix every FAIL it prints" },
  { code: "NO_RECORD", reads: "--evaluation=<record.json>", when: (g) => g.record().value === undefined, says: (g) => g.record().why, next: RECORD_NEXT },
  { code: "RECORD_SHAPE", reads: "the record's fields", when: (g) => shapeProblems(g.record().value).length > 0, says: (g) => `${g.record().file} is not a record the evaluator writes: ${shapeProblems(g.record().value)[0]}`, next: "make it again with node evaluator/cli.mjs record -- a record is never written by hand" },
  { code: "OTHER_RELEASE", reads: "the record's release and this tree's package.json version", when: (g) => g.record().value.release !== g.version(), says: (g) => `the record is about ${g.record().value.release}, and this tree is version ${g.version()}`, next: "evaluate this release under its own pre-registration, or set the version this release is" },
  { code: "PREREG_MOVED", reads: "the pre-registration file the record names", when: (g) => !g.prereg() || g.prereg().digest !== g.record().value.prereg.digest, says: (g) => (g.prereg() ? `${g.record().value.prereg.file} is not the pre-registration the record was made under (digest ${g.prereg().digest.slice(0, 12)}, the record's ${g.record().value.prereg.digest.slice(0, 12)})` : `${g.record().value.prereg.file} is not in this checkout, or is not JSON`), next: "a pre-registration never changes after its runs: evaluate under the one committed, or restore it" },
  { code: "ARTIFACT_REFUSED", reads: "git archive HEAD", when: (g) => Boolean(g.head().error) || g.head().refused.length > 0, says: (g) => g.head().error ?? `the archive of HEAD is one a host refuses: ${g.head().refused[0]}`, next: "fix what the archive holds (.gitattributes export-ignore, cli/ not bin/), commit, and evaluate the new commit" },
  { code: "REV_UNKNOWN", reads: "git archive of each release-candidate arm's commit the record names", when: (g) => unarchived(g).length > 0, says: (g) => unarchived(g).map((c) => `${c.arm}: ${c.artifact.error}`).join("; "), next: "git fetch the commit the evaluation ran (it is in the record's arms), then ask again" },
  { code: "ARTIFACT_MOVED", reads: "the content digests of git archive <each candidate commit> and git archive HEAD", when: (g) => moved(g).length > 0, says: (g) => `the plugin the evaluation ran is not the plugin HEAD ships: ${moved(g).map((c) => `${c.arm} ran ${c.commit.slice(0, 12)}`).join(", ")}; a commit that touches only export-ignored paths keeps the evidence, and this one changed what ships`, next: "run the pre-registered held-out campaigns again at this commit (prereg campaign <phase> --rev=HEAD), record, and ask again" },
  { code: "ARTIFACT_OTHER", reads: "--artifact=<zip> and git archive HEAD", when: (g) => Boolean(g.given()) && g.given().content !== g.head().content, says: () => "the archive given is not what HEAD ships: its content differs", next: "build it again with git archive --format=zip HEAD" },
  { code: "INCOMPLETE", reads: "the record's runs against every held-out run the pre-registration owes", when: (g) => missingRuns(g.prereg().value, g.record().value).length > 0, says: (g) => `pre-registered held-out runs with no outcome word: ${listed(missingRuns(g.prereg().value, g.record().value))}`, next: "resume the held-out campaigns (node evaluator/cli.mjs resume <id>) until each ends, then record again" },
  { code: "RECORD_DISAGREES", reads: "the record's comparisons against the verdict rule worked out again here", when: (g) => disagreements(g.prereg().value, g.record().value).length > 0, says: (g) => `the record's own comparisons are not what its runs say: ${disagreements(g.prereg().value, g.record().value).join(", ")}`, next: "make the record again with node evaluator/cli.mjs record -- never edit one" },
  { code: "REGRESSED", reads: "the pre-registered verdict of the release against each arm it is compared with", when: (g) => overallOf(gatingVerdicts(g)) === "REGRESSED", says: () => "the release REGRESSED against an arm the pre-registration compares it with", next: "find the defect from the runs' rooms (the general one, never the one task), fix it, and evaluate the fixed commit" },
  { code: "PUBLISHABLE", reads: "every row above", when: () => true, says: (g) => `PUBLISHABLE: the fast tier held on this tree, the evaluator's record holds for this very artifact (${g.head().content.slice(0, 12)}), complete, and the release's verdict is ${overallOf(gatingVerdicts(g))}`, next: "merge the release, tag v<version> on that commit, publish the archive of it" },
];

export function publishableOf(g) {
  const row = PUBLISH.find((r) => r.when(g));
  const ok = row.code === "PUBLISHABLE";
  return { publishable: ok, code: row.code, says: row.says(g), reads: row.reads, next: row.next, comparisons: ok ? comparisonsOf(g.prereg().value, g.record().value) : [], verdict: ok ? overallOf(gatingVerdicts(g)) : null };
}

// ---- said to a person -------------------------------------------------------------------------------------------------------

const MEANS = {
  IMPROVED: "the release resolved at least the registered margin more held-out tasks",
  NO_DIFFERENCE: "the same number of held-out tasks resolved: no difference measured",
  INCONCLUSIVE: "too few paired tasks, or a difference smaller than the registered margin: this cannot tell the arms apart",
  REGRESSED: "the release resolved fewer by the registered margin, or regressed more",
};

const money = (x) => (typeof x === "number" ? `$${x.toFixed(2)}` : "—");

const minutes = (x) => (typeof x === "number" ? x.toFixed(1) : "—");

const pair = (o, c, f) => `${f(o[c.a])} / ${f(o[c.b])}`;

const signed = (d) => (d > 0 ? `+${d}` : String(d));

const comparisonLine = (c) => `  ${c.a} against ${c.b}${c.gate ? "" : " (reported, not part of the verdict)"}: ${c.paired} paired · resolved ${pair(c.resolved, c, String)} (${signed(c.difference)}) · regressed ${pair(c.regressed, c, String)} · false done ${pair(c.falseDone, c, String)} · median cost ${pair(c.medianCostUsd, c, money)} · median minutes ${pair(c.medianMinutes, c, minutes)} -> ${c.verdict}: ${MEANS[c.verdict]}`;

export const saidEvidence = (e) => (e.publishable ? [e.says, ...e.comparisons.map(comparisonLine), `  release verdict ${e.verdict}: ${MEANS[e.verdict]}`, `  next: ${e.next}`].join("\n") : `NOT PUBLISHABLE — ${e.code}: ${e.says}\n  read: ${e.reads}\n  next: ${e.next}`);
