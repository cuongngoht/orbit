// The words a connectivity check answers in, and the one fold from what a location said to a state.
//
// Never a boolean. Whether a NAME resolved and whether a PORT answered are two facts, kept apart --
// "cannot resolve sql.corp.internal" sends a person somewhere different from "connection refused" --
// and the state over them says what a person may conclude:
//
//   NOT_CHECKED   nothing current was observed: never asked, or asked about a host or port that has
//                 since moved
//   REACHABLE     the name resolved and a TCP connection was accepted, from that location
//   UNREACHABLE   it was tried, and the name did not resolve or the connection was not accepted
//   UNKNOWN       it could not be told: a lookup that never answered, a location with nothing to ask with
//   BLOCKED       it cannot be asked from there right now -- a container that is not up -- and trying
//                 again would learn nothing until a person acts
//
// None of them is a login. A port that accepts a connection says nothing of credentials,
// permissions or what answers there; that is a test's to find.
export const STATES = ["NOT_CHECKED", "REACHABLE", "UNREACHABLE", "UNKNOWN", "BLOCKED"];

export const RESOLUTIONS = ["RESOLVED", "FAILED", "UNKNOWN", "NOT_ATTEMPTED"];

export const TRANSPORTS = ["REACHABLE", "UNREACHABLE", "UNKNOWN", "NOT_ATTEMPTED"];

// Ordered: the first row that holds names the state.
const FOLD = [
  { state: "BLOCKED", when: (a) => a.blocked === true },
  { state: "REACHABLE", when: (a) => a.transport === "REACHABLE" },
  { state: "UNREACHABLE", when: (a) => a.transport === "UNREACHABLE" || a.resolution === "FAILED" },
  { state: "UNKNOWN", when: () => true },
];

// { resolution, transport, blocked? } -> a state
export const stateOf = (answer) => FOLD.find((row) => row.when(answer)).state;

// How old an answer is, in a person's words -- the one spelling the plan's reasons, the views and
// Control's card share, so "2 min ago" means the same thing in each. null is never.
export const agoSaid = (age) => (age === null || age === undefined ? "never" : age < 10000 ? "just now" : age < 60000 ? `${Math.round(age / 1000)} s ago` : age < 3600000 ? `${Math.round(age / 60000)} min ago` : `${Math.round(age / 3600000)} h ago`);
