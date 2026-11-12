// WHAT A CODING HOST'S stream-json SAYS, read as data: its init line (model, version, the plugins it loaded), its
// result line (cost, tokens, turns, how it stopped, permission denials), its tool calls (counted by name, Skill and
// Agent calls by what they start, Bash calls that ran a plugin CLI), and its last message (the EVAL_STATUS it ended
// with, and whether it asked the person something). Everything here is the host's word: an outcome is never decided by
// it alone, and a field the stream does not carry is null, never estimated.
//
//   summaryOf(text, o) -> { started, model, version, plugins, result, costUsd, tokens, turns, durationMs, denials,
//                           subtype, isError, errorText, stoppedOn, status, statusWhy, asked, lastText, tools, orbit }
const parsed = (line) => {
  try { return JSON.parse(line); }
  catch { return null; }
};

const events = (text) => String(text ?? "").split("\n").map(parsed).filter((e) => e && typeof e === "object");

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

const str = (v, max = 200) => (typeof v === "string" && v.length <= max ? v : null);

const blocks = (e) => (Array.isArray(e.message?.content) ? e.message.content : []);

const toolUses = (es) => {
  const seen = new Map();
  for (const e of es.filter((x) => x.type === "assistant")) for (const b of blocks(e)) if (b?.type === "tool_use" && !seen.has(b.id ?? seen.size)) seen.set(b.id ?? seen.size, b);
  return [...seen.values()];
};

const tokensOf = (u) => (u && typeof u === "object" ? { input: num(u.input_tokens), output: num(u.output_tokens), cacheRead: num(u.cache_read_input_tokens), cacheWrite: num(u.cache_creation_input_tokens) } : null);

const lastAssistantText = (es) => es.filter((e) => e.type === "assistant").flatMap((e) => blocks(e).filter((b) => b?.type === "text" && typeof b.text === "string").map((b) => b.text)).at(-1) ?? null;

// The status the last message ended with: the LAST `EVAL_STATUS:` line of it.
export function statusOf(text) {
  const lines = String(text ?? "").split("\n").map((l) => l.trim()).filter((l) => /^\**EVAL_STATUS:/.test(l));
  const m = /^\**EVAL_STATUS:\**\s*(DONE|BLOCKED)\b\s*(.*)$/.exec(lines.at(-1) ?? "");
  return m ? { status: m[1], why: m[2].replace(/\**$/, "").trim().slice(0, 300) || null } : { status: null, why: null };
}

// Whether the last message leaves something for a person to answer: it ended BLOCKED, or the text before its status
// line ends on a question.
export function askedOf(text, status) {
  const body = String(text ?? "").split("\n").filter((l) => !/EVAL_STATUS:/.test(l)).join("\n").trim();
  const lastPara = body.split(/\n\s*\n/).at(-1) ?? "";
  return status === "BLOCKED" || /\?\s*\**\s*$/.test(lastPara);
}

// How the host stopped, when its result line says it stopped on a limit.
export function stoppedOn(result) {
  const s = `${result?.subtype ?? ""}`;
  if (/budget/i.test(s)) return "budget";
  if (/max_turns/i.test(s)) return "turns";
  if (result?.is_error === true && /budget/i.test(String(result?.result ?? ""))) return "budget";
  return null;
}

// An error result that is the API's or the credential's, not the agent's work: the run is INFRA_ERROR.
export const API_ERROR = /(API Error|authentication_error|invalid x-api-key|OAuth token|401|403 Forbidden|overloaded_error|\b529\b|rate_limit|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|Credit balance|Invalid API key|Please run \/login)/i;

export function apiErrorOf(result) {
  if (!result || result.is_error !== true || stoppedOn(result)) return null;
  const text = String(result.result ?? result.error ?? "");
  return API_ERROR.test(text) ? text.replace(/\s+/g, " ").slice(0, 200) : null;
}

const countBy = (xs) => xs.reduce((m, x) => ({ ...m, [x]: (m[x] ?? 0) + 1 }), {});

const escaped = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// The plugin's CLIs a Bash call ran: `<pluginDir>/cli/<x>.mjs`.
function orbitCalls(uses, pluginDir) {
  if (!pluginDir) return { commands: 0, byCli: {} };
  const re = new RegExp(`${escaped(pluginDir.replace(/\/$/, ""))}/cli/([A-Za-z0-9_-]+)\\.mjs`, "g");
  const clis = uses.filter((u) => u.name === "Bash" && typeof u.input?.command === "string").flatMap((u) => [...u.input.command.matchAll(re)].map((m) => m[1]).slice(0, 1));
  return { commands: clis.length, byCli: countBy(clis) };
}

export function summaryOf(text, o = {}) {
  const es = events(text);
  const init = es.find((e) => e.type === "system" && e.subtype === "init") ?? null;
  const result = es.filter((e) => e.type === "result").at(-1) ?? null;
  const uses = toolUses(es);
  const lastText = typeof result?.result === "string" ? result.result : lastAssistantText(es);
  const st = statusOf(lastText);
  return {
    started: Boolean(init),
    model: str(init?.model),
    version: str(init?.claude_code_version),
    plugins: Array.isArray(init?.plugins) ? init.plugins.map((p) => str(p?.name ?? p)).filter(Boolean) : null,
    skillsListed: Array.isArray(init?.skills) ? init.skills.length : null,
    result: Boolean(result),
    costUsd: num(result?.total_cost_usd),
    tokens: tokensOf(result?.usage),
    turns: num(result?.num_turns),
    durationMs: num(result?.duration_ms),
    denials: Array.isArray(result?.permission_denials) ? result.permission_denials.length : null,
    subtype: str(result?.subtype),
    isError: typeof result?.is_error === "boolean" ? result.is_error : null,
    stoppedOn: stoppedOn(result),
    apiError: apiErrorOf(result),
    status: st.status,
    statusWhy: st.why,
    asked: lastText === null ? null : askedOf(lastText, st.status),
    lastText: lastText === null ? null : String(lastText).slice(-2000),
    tools: { calls: uses.length, byName: countBy(uses.map((u) => str(u.name) ?? "unknown")), skills: countBy(uses.filter((u) => u.name === "Skill").map((u) => str(u.input?.skill) ?? "unknown")), agents: countBy(uses.filter((u) => u.name === "Agent" || u.name === "Task").map((u) => str(u.input?.subagent_type) ?? "general")) },
    orbit: orbitCalls(uses, o.pluginDir),
  };
}
