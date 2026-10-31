// WHAT THE HOST SAID about its own session, read off its stream-json output: which model it ran, how long, how many
// turns and tool calls, what it reported spending, whether it ended in an error. Every number here is REPORTED -- the
// host's word, written in a container the agent also writes to -- so it is shown as such, never verified and never
// used to decide anything but whether the host ran at all. A field the output does not carry is null, shown as
// "unknown", and never estimated.
//
//   hostOf(text) -> { started, model, version, session, turns, durationMs, apiMs, costUsd, tokens, toolCalls,
//                     tools, denials, isError, subtype, basis: "REPORTED" }
//   hostEnd(h, ran) -> null | { cause, says }
import { printable } from "../../src/printable.mjs";
import { scrub } from "../../src/scrub.mjs";

const parsed = (line) => {
  try { return JSON.parse(line); }
  catch { return null; }
};

const events = (text) => String(text ?? "").split("\n").map(parsed).filter((e) => e && typeof e === "object");

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

const str = (v) => (typeof v === "string" && v.length <= 200 ? v : null);

const toolUses = (es) => es.filter((e) => e.type === "assistant").flatMap((e) => (Array.isArray(e.message?.content) ? e.message.content : [])).filter((b) => b?.type === "tool_use").map((b) => str(b.name) ?? "unknown");

const counted = (names) => names.reduce((m, n) => ({ ...m, [n]: (m[n] ?? 0) + 1 }), {});

const tokensOf = (u) => (u && typeof u === "object" ? { input: num(u.input_tokens), output: num(u.output_tokens), cacheRead: num(u.cache_read_input_tokens), cacheWrite: num(u.cache_creation_input_tokens) } : { input: null, output: null, cacheRead: null, cacheWrite: null });

const initOf = (es) => es.find((e) => e.type === "system" && e.subtype === "init") ?? null;

const resultOf = (es) => es.filter((e) => e.type === "result").at(-1) ?? null;

// What an ERROR result said, as evidence a person reads -- scrubbed and cut to one short line, and never what a run is
// classified by.
const errorText = (result) => (result?.is_error === true && typeof result.result === "string" ? scrub(printable(result.result)).replace(/\s+/g, " ").trim().slice(0, 200) : null);

export function hostOf(text) {
  const es = events(text);
  const init = initOf(es);
  const result = resultOf(es);
  const names = toolUses(es);
  return { basis: "REPORTED", started: Boolean(init), model: str(init?.model), version: str(init?.claude_code_version), session: str(init?.session_id ?? result?.session_id), turns: num(result?.num_turns), durationMs: num(result?.duration_ms), apiMs: num(result?.duration_api_ms), costUsd: num(result?.total_cost_usd), tokens: tokensOf(result?.usage), toolCalls: names.length, tools: counted(names), denials: Array.isArray(result?.permission_denials) ? result.permission_denials.length : null, isError: typeof result?.is_error === "boolean" ? result.is_error : null, subtype: str(result?.subtype), errorText: errorText(result) };
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
