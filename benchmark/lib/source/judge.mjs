// THE JUDGE: a hidden check's expectation held against the raw answer a probe brought back -- in the controller's own
// process, which never imports the subject's code. An expectation is over a list of ids: `has` (each must be there),
// `lacks` (none may be), `exactly` (the whole set). An answer is evidence only when it is a list of ids; a throw, a
// missing answer or anything else is a failure of THAT check, said in a sentence.
//
//   judgedAnswer(c, a) -> { ok, why }          says(expect) -> sentence        answersOf(text) -> { answers } | { error }
//   judgedAll(cases, probeOut, spec) -> { checks: [{ id, group, ok, why }], error }
const uniq = (ids) => [...new Set(ids)].sort();

const listed = (ids) => (ids.length ? ids.join(", ") : "nothing");

const sameSet = (a, b) => JSON.stringify(uniq(a)) === JSON.stringify(uniq(b));

const ANSWER = [
  { when: (a) => !a, why: () => "no answer came back for it" },
  { when: (a) => a.threw !== undefined, why: (a) => `it threw: ${String(a.threw).slice(0, 200)}` },
  { when: (a) => !Array.isArray(a.got) || !a.got.every((x) => typeof x === "string"), why: () => "its answer is not a list of finding ids" },
];

const EXPECT = [
  { when: (e, got) => Array.isArray(e.exactly) && !sameSet(e.exactly, got), why: (e, got) => `expected exactly ${listed(uniq(e.exactly))}, and ${listed(got)} came back` },
  { when: (e, got) => (e.has ?? []).some((id) => !got.includes(id)), why: (e, got) => `expected ${listed(e.has)} among the findings, and ${listed(got)} came back` },
  { when: (e, got) => (e.lacks ?? []).some((id) => got.includes(id)), why: (e, got) => `expected none of ${listed(e.lacks)}, and ${listed(got)} came back` },
];

export const says = (e) => [Array.isArray(e?.exactly) ? `exactly ${listed(uniq(e.exactly))}` : null, e?.has?.length ? `includes ${listed(e.has)}` : null, e?.lacks?.length ? `never ${listed(e.lacks)}` : null].filter(Boolean).join("; ") || "anything";

export function judgedAnswer(c, a) {
  const bad = ANSWER.find((r) => r.when(a));
  if (bad) return { ok: false, why: bad.why(a) };
  const wrong = EXPECT.find((r) => r.when(c.expect ?? {}, uniq(a.got)));
  return wrong ? { ok: false, why: wrong.why(c.expect ?? {}, uniq(a.got)) } : { ok: true, why: null };
}

// The probe prints one JSON line; whatever else the subject's code printed beside it is ignored, and the LAST line
// that parses as the probe's own shape is taken.
const parsedLine = (line) => {
  try { return ((j) => (j && (Array.isArray(j.answers) || j.error) ? j : null))(JSON.parse(line)); }
  catch { return null; }
};

export const answersOf = (text) => String(text ?? "").split("\n").map(parsedLine).filter(Boolean).at(-1) ?? { error: { code: "PROBE_UNREADABLE", message: "the probe printed nothing this judge can read" } };

const byId = (answers) => new Map(answers.filter((a) => a && typeof a.id === "string").map((a) => [a.id, a]));

// Every case judged against the probe's answers, by the spec's own judge when it has one.
export function judgedAll(cases, probeOut, spec = {}) {
  const read = answersOf(probeOut);
  if (read.error) return { checks: cases.map((c) => ({ id: c.id, group: c.group, ok: false, why: `the probe could not answer: ${read.error.code}` })), error: read.error };
  const answers = byId(read.answers);
  return { checks: cases.map((c) => ({ id: c.id, group: c.group, ...(spec.judged ?? judgedAnswer)(c, answers.get(c.id)) })), error: null };
}

// What a probe is handed: the inputs, and never what they are expected to come to.
export const probeInput = (cases) => JSON.stringify({ inputs: cases.map((c) => ({ id: c.id, ...c.input })) });
