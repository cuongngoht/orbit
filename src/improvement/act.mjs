// What every step of a campaign says back, and the two ways a step ends a campaign or waits -- one shape, so the CLI,
// Orbit Control and a host's playbook read every answer the same way.
//
//   answer   { campaign, did, phase?, needs: null | "host" | "person" | "session", say, how?, outcome? }
//            needs  host     the host writes or runs something (a successor's text, a Satellite mission) -- `how` says what
//                   person   a person decides in Orbit Control
//                   session  another independent session, or later runs of ordinary work, decide -- nothing to do now
import { record } from "./ops.mjs";
import { STAGE_MODES, STAGE_OPERATIONS } from "./vocab.mjs";

export const rec = (ports, id, kind, fields, opts) => record(ports.ctx, id, kind, fields, opts);

export const answer = (c, did, extra = {}) => ({ campaign: c.id, did, needs: null, say: null, ...extra });

export const waiting = (c, needs, say, how = null) => ({ campaign: c.id, did: "WAITING", needs, say: String(say).slice(0, 240), how });

export const clip = (text) => String(text ?? "").replace(/\s+/g, " ").trim().slice(0, 240) || undefined;

const quietly = (fn) => {
  try { return fn(); }
  catch { return null; }
};

// A trail event is metadata, and a trail that cannot be written never stops a campaign.
export const traced = (ports, type, data) => quietly(() => ports.trace?.(type, data));

export function ended(ports, c, outcome, because) {
  rec(ports, c.id, "ended", { outcome, because: clip(because) });
  traced(ports, "improvement.decided", { campaign: c.id, phase: "ENDED", verdict: outcome });
  return answer(c, "ENDED", { outcome, say: clip(because) });
}

export function rejectedThenEnded(ports, c, reason, because, outcome = "candidate-rejected") {
  rec(ports, c.id, "rejected", { reason, because: clip(because), by: ports.ctx.door === "control" ? "person" : "improvement" });
  return ended(ports, c, outcome, because);
}

// The Satellite mode word and operation kind a stage is carried in, for a line and for a viewer.
export const modeOf = (stage) => ({ mode: STAGE_MODES[stage], operation: STAGE_OPERATIONS[stage] });

export const subjectPort = (ports, c) => ports.subjects[c.m.meta.subjectKind];
