// A plan finding has a LEVEL, which a case finding never needed.
//
// `query check` reports one kind of thing: a rule the map or a case broke. A
// plan is half prose, and a checker over prose that fails a build on a heuristic
// is a checker teams switch off. So the two are separated at the source:
//
//   error    a violation this tool can DEMONSTRATE -- a dangling id, a cycle, a
//            scenario committing to a layer its case has no verb for. Exit 1.
//   advice   a heuristic, or something a person has to look at. Never exit 1,
//            and never dressed up as a defect.
//
// The third state is the one that matters most and is not a level at all:
// UNKNOWN. Not knowing whether a reference has moved is not a product error and
// not coverage either -- it is reported as unknown and counted nowhere.
export const ERROR = "error";
export const ADVICE = "advice";

const made = (level, at, say) => ({ level, at, say: at ? `${at}: ${say}` : say });

export const error = (at, say) => made(ERROR, at, say);
export const advice = (at, say) => made(ADVICE, at, say);

// The declared-constraint families already put `where` in their sentence, so
// those arrive as whole strings and keep them.
export const fromStrings = (level, at, list) => list.map((say) => ({ level, at, say }));

export const errors = (found) => found.filter((f) => f.level === ERROR);
export const advisories = (found) => found.filter((f) => f.level === ADVICE);
