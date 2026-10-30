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
//   agents       (0.2.2, ADR 0044) whether the host's payload says WHICH subagent made a call, and how a subagent is
//                known to have started and stopped -- what lets a call be attributed to an agent run, never guessed
//   namesAgents  (0.2.2) true when a call that names no agent is known to be the session's own (the host names every
//                subagent's call), false when the host names none, null when nobody measured it
//   calls        (0.2.2) what names one call, so a call delivered twice or seen by two hooks is counted once
export const COVERAGE = {
  claude: { observation: "automatic", edits: "observed", commands: "observed", outcome: "exit status (a failed command is reported as one)", sessionEnd: true, namesAgents: true, agents: "observed: a subagent's calls carry its agent id and type, the Agent call answers with the id it launched, SubagentStart and SubagentStop mark its life; only its commands are seen starting", calls: "the host's tool_use_id, shared by a call's start and end", limits: [] },
  codex: { observation: "automatic", edits: "apply_patch only", commands: "Bash only", outcome: "unknown without structured evidence", sessionEnd: true, namesAgents: false, agents: "none: the payload names no subagent, so a subagent's call cannot be told from the session's own", calls: "the host's tool_use_id", limits: ["only Bash and apply_patch are mapped: edits made by other tools are not seen", "a command's exit status is not carried: results stay unknown"] },
  antigravity: { observation: "automatic", edits: "native file tools", commands: "native command tool", outcome: "unknown: command completion is not reported", sessionEnd: false, namesAgents: false, agents: "none: the payload names no subagent, so a subagent's call cannot be told from the session's own", calls: "the step index, shared by a call's start and end", limits: ["no session end: an ended session cannot be told from a quiet one, so INTERRUPTED is never derived", "a command's completion is not reported: results stay unknown"] },
  grok: { observation: "automatic", edits: "search_replace and write", commands: "run_terminal_command", outcome: "exit status (run_terminal_command reports its exit code)", sessionEnd: true, namesAgents: null, agents: "unknown: a child session's end was seen, and nothing that names which agent made a call", calls: "the host's tool_use_id", limits: ["only the tools whose payloads were measured are mapped (read_file, search_replace, write, run_terminal_command, grep): an edit by any other tool is not seen", "a plugin's SessionEnd hook gets at most 1.5 seconds, so a session's end can go unreported"] },
};

// A host Orbit has no row for is not guessed at: tracking is explicit-only there, and says so.
export const UNKNOWN_HOST = { observation: "explicit", edits: "none", commands: "none", outcome: "unknown", sessionEnd: false, namesAgents: null, agents: "none", calls: "none", limits: ["this host's hooks are not known to Orbit: only what is reported through cli/track.mjs is tracked"] };

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
