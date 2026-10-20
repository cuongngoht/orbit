// Does what engineering memory holds still describe the tree -- and does it say
// anything about the task at all?
//
// src/architecture/ensure.mjs's discipline, not its rows: pure, facts in and one
// row out, the last row always matches, every row SAYS what it decided, and what
// it may write is a COLUMN so `--dry` is the table with one flag flipped.
//
// The rows differ because the subject differs. Architecture can SCAN -- it has
// analysers that read the whole tree once. Engineering cannot: a fact here is a
// judgement about how code is built, earned by observation across sessions, and
// re-reading a scope does not re-earn it. So nothing here ever re-derives a
// fact. What `ensure` may do is re-MEASURE: restamp `status` where a scope has
// moved (or settled), and say which scopes owe a fresh observation. `stale`
// means re-observe it, and never means false.
export const DECISIONS = [
  {
    name: "BLOCKED_SOURCE",
    restamps: false,
    stops: true,
    when: (f) => !f.readable,
    say: () => "there is no readable git checkout here, so nothing can be measured or dated",
  },
  {
    name: "EMPTY",
    restamps: false,
    when: (f) => f.count === 0,
    say: () => "nothing is recorded about how this project builds code yet — `engineering observe` or `engineering record` starts it",
  },
  // The caller asked about something and nothing recorded speaks to ANY of it.
  // Freshness is still measured, but the row has to say the question went
  // unanswered, or "current" would overstate what memory knows.
  {
    name: "TARGETED",
    restamps: true,
    when: (f) => f.asked.length > 0 && f.answered.length === 0,
    say: (f) => `nothing recorded speaks to ${f.asked.join(", ")} — observe the scopes the task touches (\`engineering observe\`), or ask the observer agent for a judgement`,
  },
  {
    name: "REVALIDATE",
    restamps: true,
    when: (f) => f.moved.length > 0,
    say: (f) => `${f.moved.length} scope(s) moved or cannot be settled: ${f.moved.join(", ")} — the facts over them are marked; re-observe those and nothing else`,
  },
  {
    name: "CURRENT",
    restamps: true,
    when: () => true,
    say: (f) => `${f.count} fact(s), every watched scope still where it was recorded`,
  },
];

export function decide(facts, opts = {}) {
  const row = DECISIONS.find((d) => d.when(facts));
  const dry = Boolean(opts.dry);
  return { ...row, dry, restamps: row.restamps && !dry, say: row.say(facts), skipped: row.name === "TARGETED" ? facts.moved : [] };
}
