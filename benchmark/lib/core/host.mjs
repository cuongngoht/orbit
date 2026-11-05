// WHAT THE HOST SAID about its own session, read off its stream-json output: which model it ran, how long, how many
// turns and tool calls, what it reported spending, whether it ended in an error. Every number here is REPORTED -- the
// host's word, written in a container the agent also writes to -- so it is shown as such, never verified and never
// used to decide anything but whether the host ran at all. A field the output does not carry is null, shown as
// "unknown", and never estimated.
//
// hostOf v2 (0.5.0) keeps one row per tool call besides (`uses`): its name, the component a Skill or Agent call starts
// (`skill`, `agent`), the Agent call a subagent's call answers to (`parent`), the path a file tool names, the turn it
// was made in and the stream line it was read from, and whether its result came back marked as an error (`failed`:
// null when no result was seen). Never a prompt, never an input beyond those names, never an output. A Bash command is
// kept only by `commandsOf`, for a judge's patterns in the run's own room -- never in a metric, a report or anything
// `hostOf` returns.
//
//   hostOf(text) -> { started, model, version, session, turns, durationMs, apiMs, costUsd, tokens, toolCalls,
//                     tools, failedCalls, uses, denials, isError, subtype, basis: "REPORTED" }
//   streamOf(text) -> { init, result, uses, turns: [{ turn, thread, tokens }] }
//   commandsOf(text) -> [{ id, parent, turn, command }]        hostEnd(h, ran) -> null | { cause, says }
//   hostSummary(h) -> h without its calls one by one             effortSaid(effort) -> words
import { printable } from "../../../src/printable.mjs";
import { scrub } from "../../../src/scrub.mjs";

const parsed = (line) => {
  try { return JSON.parse(line); }
  catch { return null; }
};

// The line of the stream an event was read from, kept beside it (never printed with it): where a call sits, so the
// moment the controller saw that line arrive can be read off its capture's index.
const LINE = Symbol("line");

const lined = (e, i) => (e && typeof e === "object" ? Object.assign(e, { [LINE]: i }) : null);

const events = (text) => String(text ?? "").split("\n").map((l, i) => lined(parsed(l), i)).filter(Boolean);

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

const str = (v) => (typeof v === "string" && v.length <= 200 ? v : null);

// A longer value a judge or a reader may need (a path, a command): printable, and only when it is no longer than `max`.
const bounded = (v, max) => (typeof v === "string" && v.length <= max ? printable(v) : null);

const counted = (names) => names.reduce((m, n) => ({ ...m, [n]: (m[n] ?? 0) + 1 }), {});

const tokensOf = (u) => (u && typeof u === "object" ? { input: num(u.input_tokens), output: num(u.output_tokens), cacheRead: num(u.cache_read_input_tokens), cacheWrite: num(u.cache_creation_input_tokens) } : { input: null, output: null, cacheRead: null, cacheWrite: null });

const initOf = (es) => es.find((e) => e.type === "system" && e.subtype === "init") ?? null;

const resultOf = (es) => es.filter((e) => e.type === "result").at(-1) ?? null;

const blocksOf = (e) => (Array.isArray(e.message?.content) ? e.message.content : []);

// ---- the turns and the calls of a stream -------------------------------------------------------------------------------

// A message is one turn however many events stream it: Claude Code prints each block of a message as an event of its
// own, under one message id. An event with no id is a turn of its own.
const messageKey = (e, i) => (typeof e.message?.id === "string" ? e.message.id : `#${i}`);

// Every assistant event with its turn: the n-th distinct message of the stream, in the order it came.
function turnedOf(es) {
  const seen = new Map();
  const keyed = es.filter((e) => e.type === "assistant").map((e, i) => ({ e, key: messageKey(e, i) }));
  return keyed.map((x) => ({ e: x.e, turn: seen.has(x.key) ? seen.get(x.key) : seen.set(x.key, seen.size).get(x.key) }));
}

// Every tool result the host was handed, by the call it answers: whether it came back marked as an error.
const resultsOf = (es) => new Map(es.filter((e) => e.type === "user").flatMap(blocksOf).filter((b) => b?.type === "tool_result" && typeof b.tool_use_id === "string").map((b) => [b.tool_use_id, b.is_error === true]));

const failedOf = (results, id) => (typeof id === "string" && results.has(id) ? results.get(id) : null);

// Which component a call starts, by the field its name arrives in -- `Task` is what the Agent tool was called before.
export const INVOKES = { Skill: ["skill", "skill"], Agent: ["agent", "subagent_type"], Task: ["agent", "subagent_type"] };

// The path a file tool names, by the field it arrives in.
export const FILE_TOOLS = { Read: "file_path", Edit: "file_path", MultiEdit: "file_path", Write: "file_path", NotebookEdit: "notebook_path", Glob: "path", Grep: "path" };

const invokedOf = (b) => ((row) => (row && str(b.input?.[row[1]]) ? { [row[0]]: str(b.input[row[1]]) } : {}))(INVOKES[b.name]);

const pathOf = (b) => ((key) => (key && bounded(b.input?.[key], 1024) ? { path: bounded(b.input[key], 1024) } : {}))(FILE_TOOLS[b.name]);

const useOf = (x, b, results) => ({ id: str(b.id), name: str(b.name) ?? "unknown", parent: str(x.e.parent_tool_use_id), turn: x.turn, line: x.e[LINE], failed: failedOf(results, b.id), ...invokedOf(b), ...pathOf(b) });

// Each call once, however often the stream (or a head and a tail read together) carried the event that holds it -- and
// as the stream FIRST said it: what a container prints can only be added after a call, never cut from before it, so a
// later line under a call's id never renames the call.
const once = (rows) => [...rows.reduce((m, r, i) => (m.has(r.id ?? `#${i}`) ? m : m.set(r.id ?? `#${i}`, r)), new Map()).values()];

const toolBlocks = (x) => blocksOf(x.e).filter((b) => b?.type === "tool_use");

const usesOf = (turned, results) => once(turned.flatMap((x) => toolBlocks(x).map((b) => useOf(x, b, results))));

const sumOf = (xs) => (xs.every((x) => x === null) ? null : xs.reduce((a, b) => a + (b ?? 0), 0));

const tokensIn = (u) => sumOf([num(u?.input_tokens), num(u?.output_tokens), num(u?.cache_read_input_tokens), num(u?.cache_creation_input_tokens)]);

// One row per turn: the thread it ran in (the session's own, or the Agent call a subagent answers to) and the tokens
// its message said it used.
const turnRows = (turned) => [...new Map(turned.map((x) => [x.turn, { turn: x.turn, thread: str(x.e.parent_tool_use_id) ?? "main", tokens: tokensIn(x.e.message?.usage) }])).values()];

export function streamOf(text) {
  const es = events(text);
  const turned = turnedOf(es);
  return { init: initOf(es), result: resultOf(es), uses: usesOf(turned, resultsOf(es)), turns: turnRows(turned) };
}

// The Bash commands a session ran, for a judge's patterns: read from the run's own room where a judge needs them, and
// never handed to a metric or a report.
export const commandsOf = (text) => once(turnedOf(events(text)).flatMap((x) => toolBlocks(x).filter((b) => b.name === "Bash").map((b) => ({ id: str(b.id), parent: str(x.e.parent_tool_use_id), turn: x.turn, command: bounded(b.input?.command, 65536) }))));

// ---- what the host said -------------------------------------------------------------------------------------------------

// What an ERROR result said, as evidence a person reads -- scrubbed and cut to one short line, and never what a run is
// classified by.
const errorText = (result) => (result?.is_error === true && typeof result.result === "string" ? scrub(printable(result.result)).replace(/\s+/g, " ").trim().slice(0, 200) : null);

const callsOf = (uses) => ({ toolCalls: uses.length, tools: counted(uses.map((u) => u.name)), failedCalls: uses.filter((u) => u.failed === true).length, uses });

const endOf = (result) => ({ turns: num(result?.num_turns), durationMs: num(result?.duration_ms), apiMs: num(result?.duration_api_ms), costUsd: num(result?.total_cost_usd), tokens: tokensOf(result?.usage), denials: Array.isArray(result?.permission_denials) ? result.permission_denials.length : null, isError: typeof result?.is_error === "boolean" ? result.is_error : null, subtype: str(result?.subtype), errorText: errorText(result) });

// What a report keeps of a host's session: everything hostOf says but its calls one by one, which stay in the round's own
// evidence and in the run's tool-call facts.
export const hostSummary = (h) => (h ? Object.fromEntries(Object.entries(h).filter(([k]) => k !== "uses")) : null);

// The effort a host was asked to run at (0.5.0), in a report's words: the level asked, or -- when none was -- the host's
// own default for its model, which no stream reports.
export const effortSaid = (effort) => effort ?? "the host's default";

export function hostOf(text) {
  const s = streamOf(text);
  return { basis: "REPORTED", started: Boolean(s.init), model: str(s.init?.model), version: str(s.init?.claude_code_version), session: str(s.init?.session_id ?? s.result?.session_id), ...endOf(s.result), ...callsOf(s.uses) };
}

// How a host's session ended, as the run reads it: only what keeps a round from being a round of repair.
const ENDS = [
  { when: (h, ran) => ran.timedOut === true, cause: null, says: () => null },
  { when: (h) => !h.started, cause: "PROVIDER", says: (h, ran) => `the host never started a session (it exited ${ran.exit ?? "?"} before saying which model it runs)` },
  { when: (h) => /budget|max_turns/.test(h.subtype ?? ""), cause: "BUDGET_EXHAUSTED", says: (h) => `the host stopped on its own limit (${h.subtype})` },
  { when: (h) => h.isError === true && h.toolCalls === 0, cause: "PROVIDER", says: (h) => `the host's session ended in an error before it called a single tool${h.errorText ? `: "${h.errorText}"` : ""}` },
  { when: () => true, cause: null, says: () => null },
];

export function hostEnd(h, ran) {
  const row = ENDS.find((r) => r.when(h, ran));
  return row.cause ? { cause: row.cause, says: row.says(h, ran) } : null;
}
