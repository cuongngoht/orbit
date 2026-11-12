// WHETHER THE CONTEXT IS ENOUGH TO CHOOSE SCOPE ON, as ONE word with its reason (0.5.0, B21;
// docs/backlog/0.5.0-proactive-orchestration.md §5.4) -- read off the relevance the context package found and the
// questions already open about the task's own work, never off how many sections came back. Pure, an ordered table:
// the first row that holds is the answer, and the last always holds.
//
//   ASK       a BLOCKING unknown no source can settle: a question already asked about the work this task is about --
//             an open blocking question on its requirement (`requirements ask`), or the prerequisite its goal's analysis
//             says is missing -- still unanswered. Only a person answers it, through that same flow: nothing here asks a
//             question of its own, and nothing a read could settle is ever an ASK
//   DISCOVER  a class the task needs is empty or stale, and a source can fill it. Its TARGETS are the reads that would:
//             the host's own references (`context --with-refs`), a capability nothing recorded speaks to (`architecture
//             ensure --capability=`, the TARGETED decision -- never a full scan), the owner whose record moved under a
//             direct item, runtime understanding's component graph while it has not read the checkout (or what it read
//             moved) -- never a read already made that would find the same nothing again
//   ENOUGH    what the task touches is named, nothing it rests on moved since it was read, and nothing blocks: proceed,
//             STARTING from what is named -- and its reason says so. A direct item can rest on one word of the task
//             matching a name ("public", "api"), and a word-level reading cannot tell a meant match from an incidental
//             one: only reading the code can, which is what every playbook that reads this word does before an item
//             goes in. A rule that demoted a one-word match would send every short, specific task ("fix the login
//             page", `src/login.mjs`) to DISCOVER, and a list of words that are never meant would be one language's
//             (0.5.0 review of B21).
//
// facts: { tree, classes: { direct, dependency, downstream, verification, unknown }, stale: [{ ref, owner, id }],
//          paths, graph, understood (runtime understanding's word, or null), unanswered: [token], refused,
//          blocking: [{ flow, asks, … }] }
import { identifierTokens } from "../tokens.mjs";

export const SUFFICIENCY_WORDS = ["ENOUGH", "DISCOVER", "ASK"];

// WHOSE question is the task's: ASK waits on a person, so it is only ever a question open on the task's OWN work -- a
// work or a goal the task names by its id (the composition root asks that), or whose objective shares MORE than half of
// the words of the shorter of the two, and at least OWN_WORDS. Two words in common ("make", "order") is a task NEAR
// another work, which the WORK section may show; it is never one that must wait on that work's question.
export const OWN_WORDS = 2;

export function ownWork(objective, task) {
  const mine = identifierTokens(objective);
  const asked = identifierTokens(task);
  const shared = mine.filter((word) => asked.includes(word)).length;
  return shared >= OWN_WORDS && shared * 2 > Math.min(mine.length, asked.length);
}

export const TARGET_LIMIT = 6;

const QUOTE_LIMIT = 200;

const target = (source, what, run) => ({ source, target: what, run });

// Who re-reads a record that moved, and how: the owner's own memory-first command, never a full scan. Architecture and
// intelligence re-read a moved scope themselves; an engineering or a knowledge record is an OBSERVATION, re-made only
// by reading what it cites again, so its target is that record's own evidence. A component or a check the change
// reaches rests on runtime understanding, whose own word is `runtime discover`.
const RERUN = {
  architecture: (s) => target("architecture", s.ref, "architecture ensure"),
  intelligence: (s) => target("intelligence", s.ref, "intelligence ensure"),
  engineering: (s) => target("engineering", s.ref, `engineering why ${s.id}`),
  knowledge: (s) => target("knowledge", s.ref, `knowledge why ${s.id}`),
  plan: () => target("runtime", "component graph", "runtime discover"),
};

const sameTarget = (a, b) => a.source === b.source && a.target === b.target && a.run === b.run;

const staleTargets = (f) => f.stale.map((s) => RERUN[s.owner]?.(s) ?? target(s.owner, s.ref, null)).filter((t, at, all) => all.findIndex((x) => sameTarget(x, t)) === at);

const discoverTargets = (f) => [target("host", "references", "context --with-refs"), ...f.unanswered.map((t) => target("architecture", t, `architecture ensure --capability=${t}`))];

// How a person settles each kind of question that is already open -- relayed, never answered here. Each command is
// named as every target's `run` is: the CLI that runs it (cli/<first word>.mjs), then its arguments.
const ANSWER = {
  requirements: (q) => `a person answers it: requirements answer ${q.root} --question=${q.id} --says="…" --human`,
  goal: (q) => `a person answers it; then the goal is analyzed and planned again: orbit goal analyze ${q.goal} --stdin, then orbit goal plan ${q.goal}`,
};

const clip = (text) => String(text ?? "").slice(0, QUOTE_LIMIT);

const questionOf = (q) => ({ ...q, asks: clip(q.asks), answer: ANSWER[q.flow]?.(q) ?? null });

const related = (f) => f.classes.dependency + f.classes.downstream;

// Runtime understanding's words (src/runtime/ensure.mjs) under which `runtime discover` can still find a component graph:
// nothing has read the checkout, or what it read moved. Once it read it and found none (PARTIAL, CURRENT), or cannot
// settle it here (UNKNOWN), reading again finds the same nothing -- no gap a read can fill.
export const GRAPH_READABLE = ["NOT_DISCOVERED", "STALE"];

const graphOwed = (f) => f.paths > 0 && !f.graph && f.classes.verification === 0 && GRAPH_READABLE.includes(f.understood);

export const SUFFICIENCY = [
  { word: "ASK", row: "blocking-question", when: (f) => f.blocking.length > 0, because: (f) => `${f.blocking.length} question(s) about this task's own work are open, and only a person answers them: ${clip(f.blocking[0].asks)}`, question: (f) => questionOf(f.blocking[0]) },
  { word: "DISCOVER", row: "no-tree", when: (f) => !f.tree, because: () => "there is no tracked tree here to ground the task in — run it from the project's checkout", targets: () => [target("checkout", "tracked tree", null)] },
  { word: "DISCOVER", row: "nothing-named", when: (f) => f.classes.direct === 0, because: (f) => `nothing the task names is held by the tracked tree or by an owner${f.refused ? ` (${f.refused} proposed reference(s) refused)` : ""} — read the code for it, and propose what you find to be verified`, targets: discoverTargets },
  { word: "DISCOVER", row: "stale", when: (f) => f.stale.length > 0, because: (f) => `${f.stale.length} record(s) under a direct or verification item moved since their owner read them — re-read those, and nothing else`, targets: staleTargets },
  { word: "DISCOVER", row: "unreached", when: graphOwed, because: (f) => `the direct paths are known, and nothing says what they reach or which check holds them — runtime understanding has not read this checkout${f.understood === "STALE" ? " since what it declares moved" : " yet"}`, targets: () => [target("runtime", "component graph", "runtime discover")] },
  { word: "ENOUGH", row: "grounded", when: () => true, because: (f) => `${f.classes.direct} direct · ${related(f)} related · ${f.classes.verification} verification item(s); nothing under them moved since it was read, and no question about the work is open — start from them, and confirm each in the code before it goes in: a name one of the task's words matched is not proof the change needs it` },
];

const NO_CLASSES = { direct: 0, dependency: 0, downstream: 0, verification: 0, unknown: 0 };

const factsOf = (facts) => ({ tree: Boolean(facts.tree), classes: { ...NO_CLASSES, ...(facts.classes ?? {}) }, stale: facts.stale ?? [], paths: facts.paths ?? 0, graph: Boolean(facts.graph), understood: facts.understood ?? null, unanswered: facts.unanswered ?? [], refused: facts.refused ?? 0, blocking: facts.blocking ?? [], grounded: facts.grounded ?? 0, confirmed: facts.confirmed ?? 0, followed: facts.followed ?? 0, work: facts.work ?? null });

// ---- THREE LEVELS (0.6.0, U1): enough to investigate, to change, to conclude ---------------------------------------
//
// The word above says whether the task can choose a scope. A change needs more than that, and a conclusion more again,
// so each level is answered on its own -- `{ holds, row, because, missing }` -- by an ORDERED TABLE over facts a reader
// can demonstrate, never a count of search hits: the first row whose condition is unmet is the level's row, every unmet
// row is in `missing` (what would make it hold, and how), and the last row always holds.
//
//   investigate  a direct item the tracked tree holds: a file, or a symbol a line of it has
//   change       the direct items it rests on are CONFIRMED BY A READ -- proposed by the host after reading them
//                (`host-verified`), or cited by an owner's record whose basis is fresh -- what depends on them is known
//                or said unknown (their relations were followed: an item, nothing, or a gap), a done criterion is
//                stated (a `proof` need on the task's own work), and the check that would prove it is identified (a
//                verification item). A name the task's words matched is a candidate, never confirmed: however many
//                there are, they leave the task at investigate
//   conclude     every proof need of the task's own work is satisfied, nothing it was settled on moved since, and the
//                work's evidence, read back from its owner, is `verified` -- an owner's completed task with no edit seen
//                after it (src/work/track/view.mjs). A developer's own session can be `observed` or `reported`, never
//                verified, so it never concludes here: a person or the task's own verification does
//
// facts (beside the word's): { grounded, confirmed, followed, work: { id, proofs, unproved, moved, evidence } | null }

const WORK_NEED = "work need <w-…> --type=proof";

const unmet = (row, when, missing) => ({ row, when, missing });

export const LEVELS = {
  investigate: [
    unmet("no-tree", (f) => !f.tree, () => "a tracked tree to ground the task in — run it from the project's checkout"),
    unmet("nothing-grounded", (f) => f.grounded === 0, () => "a direct file or symbol the tracked tree holds — read the code for it, and propose it: context --with-refs"),
  ],
  change: [
    unmet("unconfirmed", (f) => f.confirmed === 0, (f) => `a direct item confirmed by a read — ${f.grounded} named, none read: read them, and propose the ones the change touches with context --with-refs`),
    unmet("dependents-unknown", (f) => f.followed === 0 && related(f) === 0, () => "what depends on the direct items, known or said unknown — propose the direct files (context --with-refs) so their relations are followed"),
    unmet("no-done-criterion", (f) => (f.work?.proofs ?? 0) === 0, (f) => `a done criterion — record it as a proof need on the task's own work: ${f.work ? WORK_NEED.replace("<w-…>", f.work.id) : "work start, then work need --type=proof"}`),
    unmet("no-check", (f) => f.classes.verification === 0, () => "the check that would prove it — a test or a declared check that holds a direct item (runtime discover, or propose the test with context --with-refs)"),
  ],
  conclude: [
    unmet("no-work", (f) => !f.work, () => "the task's own work, holding its done criteria — work start"),
    unmet("no-proof", (f) => Boolean(f.work) && f.work.proofs === 0, () => "a done criterion to conclude on — a proof need on the task's own work"),
    unmet("unproved", (f) => (f.work?.unproved ?? 0) > 0, (f) => `${f.work.unproved} proof need(s) not satisfied — settle each on its evidence: work settle ${f.work.id}`),
    unmet("moved", (f) => (f.work?.moved ?? 0) > 0, (f) => `${f.work.moved} proof need(s) rest on files that moved since they were settled — read them again and settle again`),
    unmet("unverified", (f) => Boolean(f.work) && f.work.evidence !== "verified", (f) => `the work's evidence is ${f.work.evidence} — only an owner's completed task, with no edit seen after it, is verified`),
  ],
};

export const LEVEL_NAMES = Object.keys(LEVELS);

const HOLDS = { investigate: "grounded", change: "ready", conclude: "concluded" };

const HELD = {
  investigate: (f) => `${f.grounded} direct item(s) the tracked tree holds`,
  change: (f) => `${f.confirmed} direct item(s) confirmed by a read, their relations followed, ${f.work.proofs} done criterion(s) and ${f.classes.verification} check(s) identified`,
  conclude: (f) => `${f.work.proofs} proof need(s) satisfied and unmoved, and the work's evidence is verified`,
};

function levelOf(name, f) {
  const open = LEVELS[name].filter((r) => r.when(f));
  if (!open.length) return { holds: true, row: HOLDS[name], because: HELD[name](f), missing: [] };
  return { holds: false, row: open[0].row, because: open[0].missing(f), missing: open.map((r) => r.missing(f)) };
}

const levelsOf = (f) => Object.fromEntries(LEVEL_NAMES.map((name) => [name, levelOf(name, f)]));

// What makes a direct item CONFIRMED: the host proposed it after reading it, or an owner's record cites it and that
// record's basis is fresh. A name, the listing and the request's own words confirm nothing.
const OWNER_SOURCES = ["architecture", "graph", "intelligence", "engineering", "knowledge"];

const groundedItem = (i) => i.class === "direct" && (i.kind === "file" || i.kind === "symbol");

// The host proposed it and the tree held it -- also when the engine found the same item another way, which makes its
// finder `engine` (src/context/relevance.mjs `joined`) and leaves it read all the same.
const proposedBy = (held, i) => held.some((r) => r.kind === i.kind && r.ref === i.ref);

const confirmedItem = (i, held) => groundedItem(i) && (i.by === "host-verified" || proposedBy(held, i) || (i.freshness === "current" && i.evidence.some((e) => OWNER_SOURCES.includes(e.source))));

// -> { grounded, confirmed }: what the listed items say, for the composition root to hand in. `held`: the references the
// host proposed that the tree holds (src/context/refs.mjs `verifiedRefs(...).held`).
export const directFacts = (relevant, held = []) => ({ grounded: (relevant ?? []).filter(groundedItem).length, confirmed: (relevant ?? []).filter((i) => confirmedItem(i, held)).length });

// -> { word, row, because, targets: [{ source, target, run }], question: { flow, asks, answer, … } | null,
//      levels: { investigate, change, conclude } }
export function sufficiencyOf(facts) {
  const f = factsOf(facts ?? {});
  const row = SUFFICIENCY.find((r) => r.when(f));
  return { word: row.word, row: row.row, because: row.because(f), targets: (row.targets?.(f) ?? []).slice(0, TARGET_LIMIT), question: row.question?.(f) ?? null, levels: levelsOf(f) };
}

// One line per level, after the word's: whether it holds, and what it rests on or still misses.
export const levelLines = (s) => LEVEL_NAMES.map((name) => ((l) => `  ${name.padEnd(11)} ${l.holds ? "holds" : "not yet"} -- ${l.because}${l.missing.length > 1 ? ` (+${l.missing.length - 1} more: \`--json\` names each)` : ""}`)(s.levels[name]));

// The word and its reason in the lines the context package prints: one line, then a line per target or the question.
export const sufficiencyLines = (s) => [`SUFFICIENCY  ${s.word} -- ${s.because}`, ...s.targets.map((t) => `  target  ${t.source} · ${t.target}${t.run ? ` -- ${t.run}` : ""}`), ...(s.question ? [`  question  ${s.question.asks}${s.question.answer ? ` -- ${s.question.answer}` : ""}`] : [])];
