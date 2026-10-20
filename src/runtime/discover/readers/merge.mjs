// What every reader answers, and how several answers become one.
//
//   observations   what the evidence says, as records anchored to a directory
//   unknowns       every sentence about what could not be settled
//   gaps           the SUBSET of those that mean something could not be READ at
//                  all -- a manifest that would not parse, a reader that failed,
//                  nothing to understand. Only a gap makes a checkout's
//                  understanding PARTIAL: a launch profile that was skipped, or a
//                  runner label that names no platform, is worth saying and does
//                  not make what IS understood any less so.
export const nothing = () => ({ observations: [], unknowns: [], gaps: [] });

export const merged = (parts) => ({ observations: parts.flatMap((p) => p.observations), unknowns: parts.flatMap((p) => p.unknowns), gaps: parts.flatMap((p) => p.gaps ?? []) });
