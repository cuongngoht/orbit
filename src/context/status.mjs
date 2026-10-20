// HOW MUCH project context there is, as one word read off evidence (1.8.9) -- never off a command having run, and
// never off how many sections came back. A context that answered six sections with nothing in five of them is not
// understood, and the word says so.
//
//   NOT_INITIALIZED  the machine does not know this checkout: nobody has used Orbit here (/orbit-help binds it)
//   BLOCKED          something could not answer at all on this machine (a section's command was Blocked)
//   BOOTSTRAPPED     known to Orbit, and nothing learned yet: no architecture fact is kept -- either nothing has
//                    read the repository, or it was read and held nothing a fact could stand on. It never means
//                    the project is understood
//   STALE            facts are kept, and some cite a scope that moved since they were read
//   PARTIAL          facts are kept and current, and some section had nothing it could stand on (UNKNOWN)
//   READY            every section answered from what is kept, and no fact cites a scope that moved
//
// Facts: { bound, sections: [{ id, known }], architecture: { total, stale, scanned }, blocked: string | null }.
// Pure: what the context command gathered is handed in, and a word is handed back with what it rests on.
export const CONTEXT_WORDS = ["NOT_INITIALIZED", "BLOCKED", "BOOTSTRAPPED", "STALE", "PARTIAL", "READY"];

const knownOf = (f) => f.sections.filter((s) => s.known).map((s) => s.id);
const unknownOf = (f) => f.sections.filter((s) => !s.known).map((s) => s.id);
const tally = (f) => `${knownOf(f).length} of ${f.sections.length} known${unknownOf(f).length ? `; unknown: ${unknownOf(f).join(", ")}` : ""}`;

// Ordered; the first row that matches is the word, and the last always does.
export const CONTEXT_STATES = [
  { word: "NOT_INITIALIZED", when: (f) => !f.bound, because: () => "this checkout is not known to Orbit yet — /orbit-help binds it and seats its store" },
  { word: "BLOCKED", when: (f) => Boolean(f.blocked), because: (f) => f.blocked },
  { word: "BOOTSTRAPPED", when: (f) => f.architecture.total === 0, because: (f) => `${f.architecture.scanned ? "the repository was read, and nothing in it is a fact to keep yet (no manifest or document this engine reads)" : "known to Orbit, and nothing learned yet: architecture ensure reads it once"} (${tally(f)})` },
  { word: "STALE", when: (f) => f.architecture.stale > 0, because: (f) => `${f.architecture.stale} architecture fact(s) cite a scope that moved since they were read (${tally(f)})` },
  { word: "PARTIAL", when: (f) => unknownOf(f).length > 0, because: (f) => tally(f) },
  { word: "READY", when: () => true, because: (f) => `${tally(f)}, ${f.architecture.total} architecture fact(s), none citing a scope that moved` },
];

// -> { word, because, known, unknown, summary } -- `summary` is the one line a receipt carries.
export function statusOf(facts) {
  const row = CONTEXT_STATES.find((r) => r.when(facts));
  const because = row.because(facts);
  return { word: row.word, because, known: knownOf(facts), unknown: unknownOf(facts), summary: `${row.word}: ${because}` };
}

// The first section whose command could not answer on this machine at all, said with its own words.
export const blockedOf = (sections) => ((s) => (s ? `${s.id} could not answer here — ${String(s.lines?.[0] ?? "").replace(/^UNKNOWN -- /, "")}` : null))(sections.find((x) => x.blocked));
