// A trigger, ASKED where the evidence moved and RECORDED when it says anything: the engine's own response (a retry
// needs nothing; NO_PROGRESS stops the mission) or a request for the host's next revision. src/planning/replan.mjs
// holds the table.
import { triggerOf } from "../planning/replan.mjs";

export function triggered(lw, c) {
  const t = triggerOf(c);
  if (!t || t.response === "none") return null;
  lw.append("replan.triggered", { trigger: t.id, response: t.response, unit: c.unit ?? undefined, revision: lw.m.plans.length, because: t.say(c), action: lw.action ?? undefined });
  if (t.response === "stop") lw.append("mission.failed", { stop: t.stop, because: t.say(c) });
  return t;
}
