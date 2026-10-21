// How a message or an effect is tied to THIS run (doc §5.9): by its identity -- the logical
// message id, the correlation it travels in -- never by a payload that merely looks the same,
// which another run, a retry or a replay would satisfy just as well. Each rule is a row.
import { isOp, requestOf, stepsOf } from "./skeleton.mjs";

const IDENTITY_KEYS = ["messageId", "correlationId"];

const identified = (s) => IDENTITY_KEYS.some((k) => typeof requestOf(s).match?.[k] === "string");

export const CORRELATION_RULES = [
  { id: "PUBLISH_IDENTIFIED", findings: (steps) => steps.filter((s) => isOp(s, "orbit.messaging.publish") && typeof requestOf(s).messageId !== "string").map((s) => `step ${s.i} publishes with no logical message id — a duplicate, a retry and a replay could never be told apart`) },
  { id: "AWAIT_BY_IDENTITY", findings: (steps) => steps.filter((s) => isOp(s, "orbit.observe.await") && !identified(s)).map((s) => `step ${s.i} awaits with no message id or correlation to match — a message that merely looks the same is not this run's`) },
];

export const correlationFindings = (design) => {
  const steps = stepsOf(design);
  return CORRELATION_RULES.flatMap((rule) => rule.findings(steps).map((say) => ({ rule: rule.id, say })));
};
