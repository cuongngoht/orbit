// RECALL: what the project already knows, asked of Orbit's own owners -- project context (memory first) or project
// knowledge -- read-only, through the command each owner documents, OUTSIDE the mission's lock. The answer is handed to
// the host once, scrubbed and bounded; the journal keeps only its digest (evidence.linked, TOOL_COMPLETED: that the
// owner answered, never that what it said is true).
import { canonicalJson, short } from "../../../../src/hash.mjs";
import { scrubbed } from "../../../../src/scrub.mjs";
import { isSentence } from "../../store/text.mjs";
import { ENGINE, ORCHESTRATOR, finding } from "./common.mjs";

const VIA = { context: "context.gather", knowledge: "knowledge.recall" };

const bounded = (value) => ((text) => (text.length > 24000 ? { truncated: true, text: text.slice(0, 24000) } : value))(JSON.stringify(value ?? null));

async function called(ports, a) {
  const answer = await ports.providers[a.via](a.for);
  return { ok: answer?.ok !== false, answer: bounded(scrubbed(answer?.answer ?? null)), error: answer?.error ?? null };
}

function settled(ports, lw, a, plan, got) {
  const digest = short(canonicalJson(got.answer ?? got.error ?? null), 16);
  const ok = got.ok && !got.error;
  return { outcome: ok ? "answered" : "failed", level: ok ? "TOOL_COMPLETED" : "UNKNOWN", summary: ok ? `${a.via} answered for: ${a.for}` : `${a.via} could not answer: ${got.error}`, refs: [`${a.via}:${digest}`], digests: [digest], evidence: ok ? [{ owner: a.via, ref: `${a.via}:${digest}`, level: "TOOL_COMPLETED", independent: false, digest, say: `${a.via} answered` }] : [], result: { via: a.via, answer: got.answer, error: got.error } };
}

export const recall = {
  fields: ["for", "via"],
  required: ["for", "via"],
  mode: () => "RECALLING",
  operation: (plan, a) => VIA[a.via] ?? "context.gather",
  provider: (plan, a) => (VIA[a.via] ? a.via : "context"),
  profile: ORCHESTRATOR,
  contract: (ports, lw, a) => (!VIA[a.via] ? finding("RECALL_VIA", `via is ${Object.keys(VIA).join(" or ")}`) : !isSentence(a.for) ? finding("RECALL_FOR", "for is one sentence: what to recall") : !ports.providers?.[a.via] ? finding("PROVIDER_UNBOUND", `${a.via} is not bound here`) : null),
  call: (ports, a) => called(ports, a),
  settle: settled,
};

export const recallVia = VIA;
