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
//             direct item, runtime understanding's component graph
//   ENOUGH    what the task touches is named, nothing it rests on moved since it was read, and nothing blocks: proceed
//
// facts: { tree, classes: { direct, dependency, downstream, verification, unknown }, stale: [{ ref, owner, id }],
//          paths, graph, unanswered: [token], refused, blocking: [{ flow, asks, … }] }
export const SUFFICIENCY_WORDS = ["ENOUGH", "DISCOVER", "ASK"];

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

// How a person settles each kind of question that is already open -- relayed, never answered here.
const ANSWER = {
  requirements: (q) => `a person answers it: requirements answer ${q.root} --question=${q.id} --says="…" --human`,
  goal: (q) => `a person answers it; then the goal is analyzed and planned again: goal analyze ${q.goal} --stdin, goal plan ${q.goal}`,
};

const clip = (text) => String(text ?? "").slice(0, QUOTE_LIMIT);

const questionOf = (q) => ({ ...q, asks: clip(q.asks), answer: ANSWER[q.flow]?.(q) ?? null });

const related = (f) => f.classes.dependency + f.classes.downstream;

export const SUFFICIENCY = [
  { word: "ASK", row: "blocking-question", when: (f) => f.blocking.length > 0, because: (f) => `${f.blocking.length} question(s) about this task's own work are open, and only a person answers them: ${clip(f.blocking[0].asks)}`, question: (f) => questionOf(f.blocking[0]) },
  { word: "DISCOVER", row: "no-tree", when: (f) => !f.tree, because: () => "there is no tracked tree here to ground the task in — run it from the project's checkout", targets: () => [target("checkout", "tracked tree", null)] },
  { word: "DISCOVER", row: "nothing-named", when: (f) => f.classes.direct === 0, because: (f) => `nothing the task names is held by the tracked tree or by an owner${f.refused ? ` (${f.refused} proposed reference(s) refused)` : ""} — read the code for it, and propose what you find to be verified`, targets: discoverTargets },
  { word: "DISCOVER", row: "stale", when: (f) => f.stale.length > 0, because: (f) => `${f.stale.length} record(s) under a direct or verification item moved since their owner read them — re-read those, and nothing else`, targets: staleTargets },
  { word: "DISCOVER", row: "unreached", when: (f) => f.paths > 0 && !f.graph && f.classes.verification === 0, because: () => "the direct paths are known, and nothing says what they reach or which check holds them — runtime understanding has no component graph here", targets: () => [target("runtime", "component graph", "runtime discover")] },
  { word: "ENOUGH", row: "grounded", when: () => true, because: (f) => `${f.classes.direct} direct · ${related(f)} related · ${f.classes.verification} verification item(s); nothing under them moved since it was read, and no question about the work is open` },
];

const NO_CLASSES = { direct: 0, dependency: 0, downstream: 0, verification: 0, unknown: 0 };

const factsOf = (facts) => ({ tree: Boolean(facts.tree), classes: { ...NO_CLASSES, ...(facts.classes ?? {}) }, stale: facts.stale ?? [], paths: facts.paths ?? 0, graph: Boolean(facts.graph), unanswered: facts.unanswered ?? [], refused: facts.refused ?? 0, blocking: facts.blocking ?? [] });

// -> { word, row, because, targets: [{ source, target, run }], question: { flow, asks, answer, … } | null }
export function sufficiencyOf(facts) {
  const f = factsOf(facts ?? {});
  const row = SUFFICIENCY.find((r) => r.when(f));
  return { word: row.word, row: row.row, because: row.because(f), targets: (row.targets?.(f) ?? []).slice(0, TARGET_LIMIT), question: row.question?.(f) ?? null };
}

// The word and its reason in the lines the context package prints: one line, then a line per target or the question.
export const sufficiencyLines = (s) => [`SUFFICIENCY  ${s.word} -- ${s.because}`, ...s.targets.map((t) => `  target  ${t.source} · ${t.target}${t.run ? ` -- ${t.run}` : ""}`), ...(s.question ? [`  question  ${s.question.asks}${s.question.answer ? ` -- ${s.question.answer}` : ""}`] : [])];
