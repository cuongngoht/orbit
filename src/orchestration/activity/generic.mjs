// ANY COMMAND (ADR 0020): what is shown of a check whose output no adapter reads -- a build, a linter, a test runner
// whose human-readable report is not a protocol Orbit parses. It shows the command's lifecycle (started, how long,
// how much it printed, when it last printed, how it ended) and says outright that it shows no case: a timer is never
// a progress bar, and a line that happens to contain "passed" is never a case that passed.
export const GENERIC = Object.freeze({
  id: "generic",
  framework: "any command",
  runner: null,
  capabilities: { lifecycle: true, cases: "none", total: "none", order: "reported" },
  observes: [],
  claims: () => false,
  sniff: () => false,
  parser: () => ({ line: () => [], end: () => [] }),
});

// What a line says about an adapter: the fields a viewer may show, nothing that runs.
export const described = (a) => ({ id: a.id, framework: a.framework, runner: a.runner ?? null, capabilities: { ...a.capabilities }, observes: [...(a.observes ?? [])], verified: [...(a.verified ?? [])] });
