// The commands that deal with WHAT a requirement says: record what a source says, ask what
// nobody has said, take a person's answer, freeze it, and explain how it came to be. A
// command table, every other subsystem's shape:
//
//   writes   `nothing`, or `store` (this project's machine store -- never a repository)
//   needs    what the composition root binds for it: `store` (the requirements room), or
//            `sources` (that, and the sources this project has read -- what a citation is
//            checked against, and whose word a source is)
//
// `run` answers with DATA and `say` puts it in words (a command with a `brief` has the one
// line --quiet prints instead). A command that speaks for a person -- an answer, a
// withdrawal -- is relayed with --human and refused without it: the engine records a
// decision and never makes one. A batch of proposed facts is all or nothing.
//
// This is what should be true. It reads no code, no screen and no run: a source the
// requirement rests on is a source somebody READ here, and only those.
import { Refused } from "../errors.mjs";
import { flag, has, words } from "../learn/args.mjs";
import { ask as askQuestions, answer as answerQuestion, ingest, recover } from "./ingest.mjs";
import { ROOT_SPEC } from "./store.mjs";
import { judge, parseCandidates } from "./record.mjs";
import { withdraw as withdrawQuestion } from "./questions.mjs";
import { compared, pending, refolded } from "./replay.mjs";
import { critique, handoff, review } from "./roundtable/clarify.mjs";
import { brief as briefRound, say as sayRound } from "./roundtable/progress.mjs";
import { freeze } from "./snapshot.mjs";
import { show as showSnapshot } from "./views/show.mjs";
import { status as statusView } from "./views/status.mjs";
import { why as whyView } from "./views/why.mjs";

function rootOf(args) {
  const root = words(args)[0];
  if (!new RegExp(ROOT_SPEC.pattern).test(root ?? "")) throw new Refused("name the requirement by its root id (req-…), which `acquire` prints");
  return root;
}

// A requirement is kept here once its source was acquired: a typo in a root id is not a
// new requirement, and does not make a room.
function keptRoom(ctx, args) {
  const root = rootOf(args);
  const port = ctx.requirements.open(root);
  if (!port.state().identity && port.journalLines().length === 0) throw new Refused(`no requirement ${root} is kept here — acquire its source first`);
  return { root, port };
}

const human = (args, what) => {
  if (!has(args, "human")) throw new Refused(`${what} is a person's — relay it with --human`);
};

// Lines of JSON, one proposal each; a line that is not JSON refuses the batch.
function linesOf(text) {
  const rows = parseCandidates(text);
  const bad = rows.filter((r) => r.why);
  if (bad.length) throw new Refused(bad.map((r) => r.why).join("\n"));
  return rows;
}

// ---- record --------------------------------------------------------------------------------

const judgeWorld = (ctx, port) => ({ resolves: ctx.world.resolves, seen: (sid) => port.state().sources?.[sid]?.seen ?? [], fact: (id) => port.fact(id) });

const refusal = (judged) => `nothing was recorded — a batch is all or nothing:\n  ${judged.rejected.map((r) => r.why).join("\n  ")}`;

const brief = (r) => ({ fact: r.factId, outcome: r.outcome, status: r.fact?.status ?? null, revision: r.fact?.revision ?? null, ...(r.question ? { asked: true } : {}), ...(r.replayed ? { replayed: true } : {}) });

const count = (rows, key) => rows.reduce((acc, r) => ({ ...acc, [r[key]]: (acc[r[key]] ?? 0) + 1 }), {});

function record(ctx, args) {
  const { root, port } = keptRoom(ctx, args);
  const judged = judge(parseCandidates(ctx.read(words(args)[1])), judgeWorld(ctx, port));
  if (judged.refused) throw new Refused(refusal(judged));
  const results = ingest(ctx, root, judged.accepted, { seenBy: ctx.seenBy, operation: flag(args, "operation") }).map(brief);
  return { root, results, outcomes: count(results, "outcome") };
}

const sayRecorded = (r) => [`RECORDED   ${r.results.length} candidate(s) — ${Object.entries(r.outcomes).map(([k, n]) => `${n} ${k}`).join(" · ") || "none"}`, ...r.results.map((x) => `  ${x.outcome.padEnd(9)} ${x.fact}${x.revision ? ` rev ${x.revision}` : ""}${x.status ? ` ${x.status}` : ""}${x.asked ? "  — a blocking question was opened" : ""}`)].join("\n");

// ---- ask, answer, withdraw -----------------------------------------------------------------

function ask(ctx, args) {
  const { root } = keptRoom(ctx, args);
  const questions = askQuestions(ctx, root, linesOf(ctx.read(words(args)[1])).map((r) => r.raw));
  return { root, questions: questions.map((q) => ({ id: q.id, state: q.state, blocking: q.blocking, slots: q.slots, asks: q.asks })) };
}

const sayAsked = (r) => [`ASKED      ${r.questions.length} question(s)`, ...r.questions.map((q) => `  ${q.id} ${q.state}${q.blocking ? " BLOCKING" : ""}  ${q.asks}`)].join("\n");

function answer(ctx, args) {
  human(args, "an answer");
  const { root } = keptRoom(ctx, args);
  const got = answerQuestion(ctx, root, { question: flag(args, "question"), says: flag(args, "says"), human: true, seenBy: ctx.seenBy });
  return { root, question: got.question, decision: got.decision.id, facts: got.facts.map((f) => ({ id: f.id, status: f.status, revision: f.revision })) };
}

const sayAnswered = (r) => [`DECIDED    ${r.decision} answers ${r.question}`, ...r.facts.map((f) => `  ${f.id} is now ${f.status} (revision ${f.revision})`)].join("\n");

function withdraw(ctx, args) {
  human(args, "withdrawing a question");
  const { root } = keptRoom(ctx, args);
  const q = withdrawQuestion(ctx, root, { question: flag(args, "question"), human: true, why: flag(args, "why"), seenBy: ctx.seenBy });
  return { root, question: q.id, state: q.state };
}

const sayWithdrawn = (r) => `WITHDRAWN  ${r.question} is ${r.state}; the slots it asked about stay as they were`;

// ---- clarify: the Requirement Roundtable ----------------------------------------------------------------
//
// One command, three stages, picked by the flags it is given. The engine reviews nothing -- a host's model
// does, on its own schedule -- so a round is a conversation of short calls: read the round (and the
// envelope of whoever is at work), hand a review in, hand the critique in. Every one of them prints the
// board as it stands. None of them is a person's word, and `--human` is refused here.

const mixed = (args) => {
  if (has(args, "review")) throw new Refused("name the perspective: --review=<product|domain|qa>");
  if (has(args, "critique") && flag(args, "review") !== undefined) throw new Refused("--review and --critique are two stages of a round; send one");
  if (has(args, "failed") && flag(args, "review") === undefined) throw new Refused("--failed says a review failed, and goes with --review=<perspective>");
};

const reading = (ctx, args) => ctx.read(words(args)[1]);

// The first stage whose flag was given; the last is reading the round.
const STAGES = [
  { stage: "critique", when: (args) => has(args, "critique"), run: (ctx, root, args) => critique(ctx, root, { text: reading(ctx, args), digest: flag(args, "digest") }) },
  { stage: "review", when: (args) => flag(args, "review") !== undefined, run: (ctx, root, args) => review(ctx, root, { perspective: flag(args, "review"), failed: has(args, "failed"), text: has(args, "failed") ? undefined : reading(ctx, args), digest: flag(args, "digest") }) },
  { stage: "handoff", when: () => true, run: (ctx, root) => handoff(ctx, root) },
];

function clarify(ctx, args) {
  if (has(args, "human")) throw new Refused("clarify is the engine's, and a person's answer is relayed with `answer … --human`, never with this");
  mixed(args);
  const { root } = keptRoom(ctx, args);
  return STAGES.find((s) => s.when(args)).run(ctx, root, args);
}

// ---- status, snapshot, show, why -----------------------------------------------------------

const status = (ctx, args) => statusView(ctx, keptRoom(ctx, args).root);

const sayStatus = (r) => [`REQUIREMENT ${r.root}${r.identity ? `  (${r.identity.provider} ${r.identity.id})` : ""}`, `CLARITY     ${r.clarity}`, `AUTHORITY   ${r.authority ?? "not known: no sources bound"}`, `FACTS       ${Object.entries(r.facts).map(([k, n]) => `${n} ${k}`).join(" · ") || "none"}`, ...r.open.map((q) => `OPEN        ${q.id}${q.blocking ? " BLOCKING" : ""}  ${q.asks}`), ...r.sources.map((s) => `SOURCE      ${s.id} cited at ${s.cited}${s.stale ? ` — MOVED to ${s.now}; read it again with acquire --refresh` : ""}`), `SNAPSHOT    ${r.lastSnapshot ?? "none yet"}`].join("\n");

function snapshot(ctx, args) {
  const { root } = keptRoom(ctx, args);
  const { snapshot: s, created } = freeze(ctx, root);
  return { root, created, snapshot: s.id, clarity: s.clarity, authority: s.authority, facts: s.facts.length, open: s.open.length, decisions: s.decisions.length };
}

const saySnapshot = (r) => `SNAPSHOT    ${r.snapshot} ${r.created ? "frozen" : "already frozen: nothing changed"} · clarity ${r.clarity} · authority ${r.authority} · ${r.facts} fact(s), ${r.decisions} decision(s), ${r.open} still open`;

const show = (ctx, args) => showSnapshot(ctx, words(args)[0] ?? "", { root: flag(args, "root") });

const sayShown = (r) => [`SNAPSHOT    ${r.snapshot.id} · clarity ${r.snapshot.clarity} · authority ${r.snapshot.authority}`, ...r.facts.map((f) => `  ${f.subject}/${f.aspect}  [${f.status}, rev ${f.revision}]  ${f.says}`), ...r.open.map((q) => `  OPEN ${q.id}${q.blocking ? " BLOCKING" : ""}  ${q.asks ?? ""}`)].join("\n");

function why(ctx, args) {
  const { root } = keptRoom(ctx, args);
  return whyView(ctx, root, words(args)[1] ?? "");
}

const sayWhy = (r) => [`${r.kind.toUpperCase()}  ${r.id}`, ...r.history.map((l) => `  ${l.sequence}  ${l.kind}${l.outcome ? ` ${l.outcome}` : ""}${l.because ? ` — ${l.because}` : ""}`), ...r.versions.map((v) => `  version ${v.revision} (${v.status}): ${v.says}`)].join("\n");

// ---- replay, where -----------------------------------------------------------------------------

const healing = (plan) => ({ facts: plan.facts.map((p) => p.fact.id), questions: plan.questions.map((q) => q.id), decisions: plan.decisions.map((d) => d.id) });

function replay(ctx, args) {
  const { root, port } = keptRoom(ctx, args);
  const healed = has(args, "check") ? healing(pending(port)) : port.transact(() => recover(port));
  const verdicts = compared(port.facts(), refolded(port.journalLines(), root));
  return { root, check: has(args, "check"), healed, verdicts, differences: verdicts.filter((v) => v.verdict !== "same").length };
}

const sayReplay = (r) => [`REPLAY      ${r.root} — ${r.verdicts.length} fact(s), ${r.differences} difference(s)${r.check ? " (checked, nothing written)" : ""}`, ...r.verdicts.filter((v) => v.verdict !== "same").map((v) => `  ${v.verdict.padEnd(12)} ${v.id}`)].join("\n");

const where = (ctx) => ({ store: ctx.store.root, requirements: ctx.requirements.paths.root, sources: ctx.sources.paths.root, kept: ctx.requirements.roots() });

const sayWhere = (r) => [`STORE        ${r.store}`, `REQUIREMENTS ${r.requirements}`, `SOURCES      ${r.sources}`, `KEPT         ${r.kept.join(", ") || "none yet"}`].join("\n");

export const COMMANDS = {
  record: { run: record, say: sayRecorded, writes: "store", needs: "sources" },
  ask: { run: ask, say: sayAsked, writes: "store", needs: "store" },
  clarify: { run: clarify, say: sayRound, brief: briefRound, writes: "store", needs: "store" },
  answer: { run: answer, say: sayAnswered, writes: "store", needs: "store" },
  withdraw: { run: withdraw, say: sayWithdrawn, writes: "store", needs: "store" },
  status: { run: status, say: sayStatus, writes: "nothing", needs: "sources" },
  snapshot: { run: snapshot, say: saySnapshot, writes: "store", needs: "sources" },
  show: { run: show, say: sayShown, writes: "nothing", needs: "store" },
  why: { run: why, say: sayWhy, writes: "nothing", needs: "store" },
  replay: { run: replay, say: sayReplay, writes: "store", needs: "store" },
  where: { run: where, say: sayWhere, writes: "nothing", needs: "store" },
};

export const COMMAND_NAMES = Object.keys(COMMANDS);
