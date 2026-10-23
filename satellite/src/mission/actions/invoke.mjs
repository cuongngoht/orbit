// INVOKE: ONE capability asked on behalf of an OPEN agent run, through the doors Orbit already keeps and no other. The
// resolver picks the provider at that very moment -- one a person switched off is never offered -- and the call goes
// through the MCP broker narrowed to reading, or a project's capability pipeline with no case (Orbit's
// src/work/invoke.mjs `invokeBound`), OUTSIDE the mission's lock, and is asked once.
//
// It is a NESTED action: while it is open its run shows DISPATCHING on top of the run's own mode, and the run's own
// mode again once it is recorded. It is capped by what its run was granted, so only a run whose mode reads through a
// provider (EXPLORING) may ask one. The journal keeps the receipt's digests; the answer is handed to the host once,
// scrubbed and bounded, and kept nowhere. A call its door says WROTE counts for nothing; a provider that waits for a
// person's approval is refused (nothing here can prove a person), and so is one that reads through a connection's
// credential (only Orbit's own coordinator is handed one).
import { canonicalJson, short } from "../../../../src/hash.mjs";
import { isObject, list, quietly, secretShaped } from "../../store/text.mjs";
import { ORCHESTRATOR, finding } from "./common.mjs";

export const INVOKE_LIMITS = Object.freeze({ inputBytes: 8192, expects: 8, answerChars: 24000, sourceRefs: 8 });

const CAPABILITY = /^[a-z][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*)+$/;
const FIELD = /^[A-Za-z_][A-Za-z0-9_-]{0,63}$/;
const TOOL = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,79}$/;

// A provider a call can be asked of: a server Orbit manages, or the project's own capability. Anything else (a skill,
// an agent, a host's own server) is followed or run by the host, never invoked.
const servable = (p) => p?.kind === "mcp" || (p?.kind === "capability" && p.ownership === "project");

export function planInvoke(ports, lw, a) {
  const run = a.agentRun ? lw.m.runs.get(a.agentRun) ?? null : null;
  const resolution = CAPABILITY.test(String(a.capability ?? "")) && ports.resolve ? quietly(() => ports.resolve(a.capability)) : null;
  return { run, resolution, binding: servable(resolution?.provider) && ports.invoker ? quietly(() => ports.invoker.bind(resolution)) : null };
}

const inputBytes = (a) => Buffer.byteLength(JSON.stringify(a.input ?? {}));

const badExpects = (e) => e !== undefined && (!Array.isArray(e) || e.length > INVOKE_LIMITS.expects || !e.every((f) => FIELD.test(String(f))));

const RULES = [
  { rule: "INVOKE_CAPABILITY", fails: (a) => !CAPABILITY.test(String(a.capability ?? "")), say: () => "capability is one dotted word, such as docs.search" },
  { rule: "RUN_NOT_OPEN", fails: (a, p) => !p.run || Boolean(p.run.ended), say: (a) => `${a.agentRun} is no open agent run of this mission: a capability is asked on behalf of one` },
  { rule: "INVOKE_INPUT", fails: (a) => (a.input !== undefined && !isObject(a.input)) || inputBytes(a) > INVOKE_LIMITS.inputBytes, say: () => `input is one JSON object of at most ${INVOKE_LIMITS.inputBytes} bytes` },
  { rule: "INVOKE_SECRET", fails: (a) => secretShaped(JSON.stringify(a.input ?? {})), say: () => "the input holds something shaped like a secret: a secret is named, never sent" },
  { rule: "INVOKE_TOOL", fails: (a) => a.tool !== undefined && !TOOL.test(String(a.tool)), say: () => "tool is the name a managed server gives one of its tools" },
  { rule: "INVOKE_EXPECTS", fails: (a) => badExpects(a.expects), say: () => `expects is at most ${INVOKE_LIMITS.expects} field names the answer must hold` },
  { rule: "PROVIDER_UNBOUND", fails: (a, p, ports) => !ports.resolve || !ports.invoker, say: () => "no resolver or invocation door is bound here" },
  { rule: "CAPABILITY_UNPROVIDED", fails: (a, p) => p.resolution?.outcome !== "provided" || !p.resolution.provider, say: (a, p) => `nothing may serve ${a.capability} now: ${p.resolution?.why ?? "the resolver could not tell"}` },
  { rule: "CAPABILITY_APPROVAL", fails: (a, p) => p.resolution.status === "approval", say: (a, p) => `${p.resolution.provider.id} serves ${a.capability} only once a person approves it in Orbit Control, and nothing here can prove a person` },
  { rule: "CAPABILITY_HOST_ONLY", fails: (a, p) => !servable(p.resolution.provider), say: (a, p) => `${a.capability} is served by ${p.resolution.provider.kind} ${p.resolution.provider.id}, which the host follows or runs, never Satellite` },
  { rule: "CAPABILITY_UNBOUND", fails: (a, p) => !p.binding, say: (a, p) => `${p.resolution.provider.id} is not in the registry any more` },
  { rule: "CAPABILITY_CONNECTION", fails: (a, p) => Boolean(p.binding.connection), say: (a, p) => `${p.resolution.provider.id} reads through a connection's credential, which only Orbit's own coordinator is handed` },
];

function contracted(ports, lw, a, p) {
  const row = RULES.find((r) => r.fails(a, p, ports));
  return row ? finding(row.rule, row.say(a, p)) : null;
}

// What is asked of the door: reading only, always, and in Satellite's name.
const askOf = (a) => ({ capability: a.capability, ...(a.tool ? { tool: a.tool } : {}), input: a.input ?? {}, workflow: "orbit-satellite", readOnly: true });

const holds = (answer, expects) => list(expects).length > 0 && isObject(answer) && list(expects).every((f) => answer[f] !== undefined && answer[f] !== null);

// What a call came to, by what its door's receipt says -- the first row that holds; the last always does.
const OUTCOMES = [
  { when: (g) => !g?.receipt, outcome: "failed", level: "UNKNOWN", say: (g) => `the call could not be made: ${g?.error?.message ?? g?.error ?? "the door kept no receipt"}` },
  { when: (g) => g.receipt.outcome !== "ok", outcome: "failed", level: "UNKNOWN", say: (g) => `${g.receipt.provider} ended ${g.receipt.outcome}${g.receipt.why ? `: ${g.receipt.why}` : ""}` },
  { when: (g) => g.operation !== "read", outcome: "failed", level: "UNKNOWN", say: (g) => `OPERATION_WRITE: ${g.receipt.provider} says the call wrote, and a read-only invocation that wrote counts for nothing` },
  { when: (g, a) => holds(g.answer, a.expects), outcome: "answered", level: "CONTRACT_MET", say: (g, a) => `${g.receipt.provider} answered with every field asked for (${list(a.expects).join(", ")})` },
  { when: () => true, outcome: "answered", level: "TOOL_COMPLETED", say: (g) => `${g.receipt.provider} answered` },
];

const sixteen = (digest) => String(digest ?? "").slice(0, 16) || null;

const digestsOf = (g) => [sixteen(g?.receipt?.queryDigest), sixteen(g?.receipt?.resultDigest)].filter(Boolean);

const boundedAnswer = (answer) => ((text) => (text.length > INVOKE_LIMITS.answerChars ? { truncated: true, text: text.slice(0, INVOKE_LIMITS.answerChars) } : answer))(JSON.stringify(answer ?? null));

const resultOf = (a, g) => ({ capability: a.capability, provider: g?.receipt?.provider ?? null, tool: g?.receipt?.tool ?? null, outcome: g?.receipt?.outcome ?? "error", answer: g?.receipt?.outcome === "ok" ? boundedAnswer(g.answer) : null, sourceRefs: list(g?.receipt?.sourceRefs).slice(0, INVOKE_LIMITS.sourceRefs) });

function settled(ports, lw, a, p, got) {
  const row = OUTCOMES.find((o) => o.when(got, a));
  const ref = `capability:${a.capability}:${sixteen(got?.receipt?.resultDigest) ?? short(canonicalJson(got?.receipt ?? null), 16)}`;
  const kept = row.outcome === "answered" ? [{ owner: "capability", ref, level: row.level, independent: false, digest: sixteen(got.receipt.resultDigest), say: row.say(got, a) }] : [];
  return { outcome: row.outcome, level: row.level, summary: row.say(got, a), refs: [ref], digests: digestsOf(got), evidence: kept, result: resultOf(a, got) };
}

export const invoke = {
  fields: ["capability", "agentRun", "tool", "input", "expects"],
  required: ["capability", "agentRun"],
  plan: planInvoke,
  mode: () => "DISPATCHING",
  operation: () => "provider.invoke",
  provider: () => "capability",
  profile: ORCHESTRATOR,
  unitOf: (p) => p.run?.unit,
  runOf: (p, a) => a.agentRun,
  parentOf: (p) => p.run?.action,
  contract: contracted,
  call: (ports, a, p) => ports.invoker.call(p.binding, askOf(a)),
  settle: settled,
};
