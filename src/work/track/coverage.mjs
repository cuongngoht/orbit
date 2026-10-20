// WHAT EACH HOST LETS TRACKING OBSERVE, as data: a row per host, a column per thing. A host that cannot show a thing is
// `none` and says why; nothing here guesses, and a viewer prints the limits beside the work so a missing line is never
// read as "nothing happened". The rows are the facts docs/hosts.md records from each host's payload -- when a host's
// adapter learns more, the row changes, never a view.
//
//   observation  automatic (the host's hooks append what its tools did) · explicit (only what the model reports through
//                `cli/track.mjs`) -- tracking is the same journal either way
//   edits · commands   what the working set can say of a tool call
//   outcome      how a command's end is known
//   sessionEnd   whether the host says its session ended (so INTERRUPTED can be told from a quiet session)
export const COVERAGE = {
  claude: { observation: "automatic", edits: "observed", commands: "observed", outcome: "exit status (a failed command is reported as one)", sessionEnd: true, limits: [] },
  codex: { observation: "automatic", edits: "apply_patch only", commands: "Bash only", outcome: "unknown without structured evidence", sessionEnd: true, limits: ["only Bash and apply_patch are mapped: edits made by other tools are not seen", "a command's exit status is not carried: results stay unknown"] },
  antigravity: { observation: "automatic", edits: "native file tools", commands: "native command tool", outcome: "unknown: command completion is not reported", sessionEnd: false, limits: ["no session end: an ended session cannot be told from a quiet one, so INTERRUPTED is never derived", "a command's completion is not reported: results stay unknown"] },
  grok: { observation: "automatic", edits: "search_replace and write", commands: "run_terminal_command", outcome: "exit status (run_terminal_command reports its exit code)", sessionEnd: true, limits: ["only the tools whose payloads were measured are mapped (read_file, search_replace, write, run_terminal_command, grep): an edit by any other tool is not seen", "a plugin's SessionEnd hook gets at most 1.5 seconds, so a session's end can go unreported"] },
};

// A host Orbit has no row for is not guessed at: tracking is explicit-only there, and says so.
export const UNKNOWN_HOST = { observation: "explicit", edits: "none", commands: "none", outcome: "unknown", sessionEnd: false, limits: ["this host's hooks are not known to Orbit: only what is reported through cli/track.mjs is tracked"] };

export const coverageOf = (host) => ({ host: host ?? null, ...(COVERAGE[host] ?? UNKNOWN_HOST) });

// Why a work shows no observed activity, in words: the working set's own source says (src/live/session.mjs SOURCES).
const SOURCE_LIMITS = {
  off: "the working set is switched off: no tool activity is recorded",
  "no-session": "this shell carries no session mark: activity cannot be attributed to a session",
  "no-project": "this directory is not a project Orbit knows",
  unreadable: "this session's working set could not be read",
};

export const limitsOf = (coverage, source) => [...coverage.limits, ...(SOURCE_LIMITS[source] ? [SOURCE_LIMITS[source]] : [])];

// The host a command runs under, from the environment a composition root hands in: the host's own name when it gave one a
// name can be, else Claude Code's (the only host that exports none).
export const hostFrom = (env) => (/^[a-z][a-z0-9-]{0,39}$/.test(env?.ORBIT_HOST ?? "") ? env.ORBIT_HOST : "claude");
