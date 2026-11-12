// CONDITIONS OF USE (0.6.0, P1): the facts about a session's WORK that bring a component in, as data -- never a word
// of a prompt. A catalog row says which of them its own playbook handles (`reactsTo`, catalog/components.json); the
// resolver treats a row's fact that holds the way it treats one of its own signals in the prompt
// (src/routing/select.mjs `judged`): evidence that names it, so a component recommended on its own evidence alone
// (`requiresSignal`) may be chosen with no word of the prompt naming it.
//
// Shaped like INTENTS (src/routing/intents.mjs): each row says what it `requires` -- the requirement a fact that holds
// adds to what the session asks for, so the existing resolver picks who provides it -- and `say`, the sentence a line
// gives as the reason. And it says how the fact is DERIVED: `derive(seen)` over what the composition root read of the
// session (src/lifecycle/advice.mjs `seenOf`), answering the fact's SUBJECT (a check's class and executable, a need's
// subject) or null. A word nobody can derive is not a word: no model, no context run inside a hook, never the text of
// an error, and never a guess at a cause (src/orchestration/failure.mjs classifies a task's check; this says the fact).
//
//   seen: { checks: { last: { class, exe, ok, afterEdit } | null, repeats: { class, exe, n } | null } }   (checks.mjs)
//
// Ordered: when several hold, the first is the one a line says. A LEAF: it imports nothing and reads nothing.

// What a check is, said as the trail says a shell step: its class and its bare executable.
export const checkSaid = (c) => `${c.class}${c.exe ? ` (${c.exe})` : ""}`;

// How many failures of one check in a row, with nothing changed between, are no progress (P5): said once, as that.
export const REPEATS = 3;

const repeated = (seen) => ((r) => (r && r.n >= REPEATS ? checkSaid(r) : null))(seen?.checks?.repeats ?? null);

const lastFailed = (seen) => ((c) => (c && c.ok === false && c.afterEdit === true ? checkSaid(c) : null))(seen?.checks?.last ?? null);

export const FACTS = [
  { fact: "check.repeats", requires: ["development.implementation"], say: `the same check failed ${REPEATS} or more times in a row with nothing changed between: diagnose why before running it again -- running it again will not change it`, derive: repeated },
  { fact: "check.failed", requires: ["development.implementation"], say: "a check the session ran after its edits failed: find the cause in the change and the output before editing again", derive: lastFailed },
];

export const FACT_WORDS = FACTS.map((f) => f.fact);

const rowOf = (fact) => FACTS.find((f) => f.fact === fact) ?? null;

// Every fact that holds over what was seen, in table order: { fact, subject }.
export const observedOf = (seen) => FACTS.map((f) => ({ fact: f.fact, subject: f.derive(seen ?? {}) })).filter((o) => o.subject);

// A classification with what the observed facts require added, each node saying which fact asked for it -- the shape
// classify() answers, so the graph and the resolver read it as they read a refinement's.
export function withFacts(asked, observed) {
  const known = new Set((asked.asked ?? []).map((n) => n.requirement));
  const added = (observed ?? []).flatMap((o) => (rowOf(o.fact)?.requires ?? []).map((requirement) => ({ requirement, level: "conditional", because: `after ${o.fact}` })));
  const fresh = added.filter((n, i) => !known.has(n.requirement) && added.findIndex((m) => m.requirement === n.requirement) === i);
  return { ...asked, asked: [...(asked.asked ?? baseOf(asked)), ...fresh], requirements: [...new Set([...(asked.requirements ?? []), ...fresh.map((n) => n.requirement)])] };
}

const baseOf = (asked) => (asked.requirements ?? []).map((requirement) => ({ requirement, level: "required", because: `intent ${asked.intent?.id}` }));
