// SELF-IMPROVEMENT, nudged from the hooks (0.3.0, ADR 0045) -- and only nudged. When a turn or a session ends, for a
// checkout the machine knows, a process of its own runs detection (`improve analyse --hook`): debounced, bounded, and
// never an evaluation. Nothing here reads a journal, decides anything or speaks to the host; what it cannot do is the
// next session's to find, and `records` makes a throw a finding rather than a failed turn.
export const improvement = {
  name: "improvement",
  on: ["turn-end", "session-end"],
  records: true,
  run: (event, world) => (world.improveLater?.(event) ? null : null),
};
