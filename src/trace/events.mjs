// The SESSION TRAIL's vocabulary -- every event anything may emit, as a table.
//
// The trail is event-driven on purpose. PRODUCERS (the hooks, the knowledge
// command) emit a fact the moment it happens and know nothing of who reads it;
// the append-only LOG (src/trace/log.mjs) is the only thing between processes
// that never share memory; CONSUMERS are PROJECTIONS (src/trace/projections/),
// pure folds rebuilt from the log on every read -- the decision trace, the usage
// analytics -- so a new question is a new fold over the same events, and no
// answer is ever stored beside them to drift.
//
// An event is an immutable, past-tense FACT, and its data is an ALLOW-LIST per
// type: a field nobody declared here is dropped, so a producer that one day
// hands over more than it should cannot put it on disk -- the rule
// src/mcp/activity.mjs and a report's STRUCTURAL list already keep. Never a
// prompt's text, a response, a model's reasoning, a transcript, a tool's input
// or output, a command's arguments, a path or a file's contents: there is no
// field for any of them.
//
//   { v, id, at, type, session, project, data }
//
// `session` is the host's session, hashed (src/lifecycle/event.mjs); `project`
// a short hash of the store key; `id` unique per event, so a reader that sees a
// line twice counts it once.
import { scrubbed } from "../scrub.mjs";

export const TRACE_VERSION = 2;

export const EVENT_TYPES = [
  { type: "prompt.submitted", fields: ["prompt", "routing", "intent", "confidence", "cues", "requirements", "graph", "selected", "approval", "blocked", "missing", "injected"], doc: "a person submitted a prompt: a salted hash of it and its length, and what the prompt router decided — table words and resource ids, never the text" },
  { type: "skill.invoked", fields: ["id", "ours", "outcome", "call", "agent"], doc: "the session started a skill, or its switch refused it: which call it was and, when a subagent made it, the agent's hashed id" },
  { type: "agent.invoked", fields: ["id", "ours", "outcome", "call", "agent", "run"], doc: "the session started a subagent, or its switch refused it: which call, the agent that made it when it was a subagent, and the qualified mission run an Orbit envelope named -- never the prompt" },
  { type: "agent.launched", fields: ["id", "call", "agent", "launched", "run"], doc: "an agent call answered with the hashed id of the agent it launched: which call, which agent made it, the one it launched, and the qualified mission run an Orbit envelope named" },
  { type: "agent.started", fields: ["id", "agent"], doc: "the host said a subagent began: its type and hashed id -- never its prompt" },
  { type: "agent.ended", fields: ["id", "agent"], doc: "the host said a subagent stopped: its type and hashed id -- never its last message or its transcript" },
  { type: "tool.used", fields: ["tool", "kind", "ok", "call", "agent"], doc: "the session used a tool: its name and kind, the call's hashed id and the subagent that used it, never its input or its output" },
  { type: "command.ran", fields: ["orbit", "sub", "class", "exe", "ok", "call", "agent"], doc: "the session ran a command: the Orbit script and a subcommand its own usage documents, or else a class and the executable's bare name, the call's hashed id and the subagent that ran it — never an argument" },
  { type: "turn.ended", fields: [], doc: "the host finished answering a prompt" },
  { type: "session.ended", fields: [], doc: "the session ended" },
  { type: "knowledge.opportunity.offered", fields: ["opportunity", "capability", "workflow", "purpose", "surface"], doc: "a capability opportunity was put to a person" },
  { type: "knowledge.opportunity.decided", fields: ["opportunity", "capability", "action", "workflow"], doc: "a person decided about a capability opportunity" },
  { type: "requirements.source.acquired", fields: ["root", "sources", "changed", "anomalies"], doc: "a requirement's source was read: how many items, how many moved, how many said one thing and meant another" },
  { type: "requirements.recorded", fields: ["root", "outcomes"], doc: "proposed requirement facts were recorded: the count of each outcome, never a fact" },
  { type: "requirements.question.asked", fields: ["root", "questions", "blocking"], doc: "a question was put on a requirement, and how many of them stop the work" },
  { type: "requirements.decision.recorded", fields: ["root", "question"], doc: "a person answered a question about a requirement" },
  { type: "requirements.snapshot.created", fields: ["root", "snapshot", "clarity", "authority"], doc: "a requirement was frozen: which snapshot, how clear, whose word" },
  { type: "requirements.roundtable.reviewed", fields: ["root", "perspective", "candidates"], doc: "one perspective of a clarification round handed in: which, and how many questions it proposed -- never a question" },
  { type: "requirements.roundtable.closed", fields: ["root", "round", "pooled", "retained", "asked", "stop"], doc: "a clarification round was closed: how many questions were proposed, kept and put to a person, and why the round stopped" },
  { type: "work.started", fields: ["work", "snapshot"], doc: "a piece of work was started on a requirement: which one, and the snapshot it rests on" },
  { type: "work.checkpoint", fields: ["work", "frontier", "stale"], doc: "a work was marked where it stands: how many needs are ready, and how many went stale since it was last looked at" },
  { type: "work.resumed", fields: ["work", "revalidated", "stale"], doc: "a session picked a work up: how many needs were looked at again, and how many had gone stale" },
  { type: "work.need.settled", fields: ["work", "need", "state"], doc: "a need was settled, blocked or found not to be needed" },
  { type: "runtime.discovered", fields: ["decision", "state", "facts", "gaps"], doc: "a checkout's runtime evidence was read, or found current: the decision, the understanding it came to, how many facts, and how many things could not be read -- never a fact, a path or a command" },
  { type: "runtime.proposal.adopted", fields: ["proposal", "state", "files"], doc: "a person adopted an environment proposal: its id, the state the environment is in, and how many files were written" },
  { type: "runtime.connectivity.checked", fields: ["mode", "locations", "reachable", "attempts"], doc: "a reach target was checked once or retried: from how many locations, how many accepted a connection, and how many attempts it took -- never the target, a host or a port" },
  { type: "runtime.started", fields: ["started", "reused", "skipped", "blocked"], doc: "components were started: how many were, how many an external server already answered for, how many already were, and how many could not be -- never which command" },
  { type: "runtime.stopped", fields: ["stopped", "refused", "released"], doc: "sessions were stopped: how many were, how many were refused because they could not be proven Orbit's, and how many a person released" },
  { type: "task.started", fields: ["task"], doc: "an execution of a work was started as a task: its id -- never its objective" },
  { type: "task.attempt", fields: ["task", "attempt", "outcome"], doc: "a task's attempt started or ended: which, and how it ended -- never what it did" },
  { type: "task.approval.decided", fields: ["task", "approval", "decision"], doc: "a person granted or rejected one action a task asked for: which approval, and the word -- never the action's parameters" },
  { type: "task.finished", fields: ["task", "lifecycle"], doc: "a task completed, failed or was cancelled. The task's journal is its record; this is a projection of one moment of it" },
  { type: "learning.observed", fields: ["host", "milestone", "operation", "candidates", "accepted"], doc: "the engineering observer ran (1.8.9): for which host, at which milestone or for which finished task, how many candidates it proposed and how many reconciliation kept -- never a fact, a path or a file name" },
  { type: "improvement.detected", fields: ["campaign", "subject", "signal", "sessions", "runs"], doc: "a self-improvement campaign started (0.3.0, ADR 0045): which campaign, about which playbook or definition, on which signal, from how many independent sessions and runs -- the campaign's journal is its record" },
  { type: "improvement.decided", fields: ["campaign", "phase", "verdict"], doc: "a campaign moved on evidence: the phase it reached and the word that moved it (a verdict, an outcome, a stop) -- never a sentence of why" },
  { type: "improvement.promoted", fields: ["campaign", "subject", "from", "to"], doc: "a candidate was chosen to run for new work, through its owner's door: the version it replaced and the one it is (pins)" },
  { type: "improvement.rolled_back", fields: ["campaign", "subject", "from", "to"], doc: "a promoted candidate regressed and the version it replaced was chosen again (pins)" },
  { type: "connection.auth", fields: ["provider", "strategy", "phase", "outcome"], doc: "a connection's sign-in did something: which provider and strategy, which phase (tool, token, login, logout) and how it ended in a fixed word -- never an account, a directory, a tenant, a token or anything a tool printed" },
  { type: "trace.dropped", fields: ["reason"], doc: "the trail stopped keeping events for a while — a shard reached its cap" },
];

export const TYPE_NAMES = EVENT_TYPES.map((t) => t.type);

const BY_TYPE = Object.fromEntries(EVENT_TYPES.map((t) => [t.type, t]));

export const typeRow = (type) => BY_TYPE[type] ?? null;

// One event, or null for a type nobody declared. The data is cut to the row's
// allow-list and scrubbed by shape besides -- the second lock on the door.
export function eventOf(type, data, meta) {
  const row = BY_TYPE[type];
  if (!row) return null;
  const fields = [...row.fields, "outcome"];
  const kept = Object.fromEntries(fields.filter((k) => data?.[k] !== undefined && data?.[k] !== null).map((k) => [k, data[k]]));
  return { v: TRACE_VERSION, id: meta.id, at: meta.at, type, session: meta.session ?? null, project: meta.project ?? null, data: scrubbed(kept), ...provenance(meta) };
}

// What a reader keeps of a line it did not write: a known version and type,
// with the same allow-list applied again -- so a line from a newer engine, or
// one somebody edited, can never bring an undeclared field onto a page.
export function readable(line) {
  const row = BY_TYPE[line?.type];
  if (!row || line.v !== TRACE_VERSION || typeof line.id !== "string" || typeof line.at !== "string") return null;
  return eventOf(line.type, line.data, line);
}

const provenance = (meta) => ({ agentHost: safe(meta.agentHost), turn: safe(meta.turn) });
const safe = (value) => typeof value === "string" && /^[a-zA-Z0-9:_-]{1,96}$/.test(value) ? value : null;
