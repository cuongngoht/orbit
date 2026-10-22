// What a backend test may say about TIME (doc §5.3, §5.9): a window is the compiler's, from an
// accepted criterion's own `within` -- never a number a host chose until a test went green; a
// business clock is moved only through an adapter that says it can inject one; and a skeleton
// carries no verdict text at all, because the engine compiles every verdict. Each rule is a row.
import { meets } from "../../adapters/semantics.mjs";
import { isOp, requestOf, stepsOf } from "./skeleton.mjs";

const WINDOWED = ["orbit.observe.await", "orbit.scheduler.observe", "orbit.worker.observe", "orbit.job.observe"];
const VERDICT_TEXT = ["expect", "js"];

export const TEMPORAL_RULES = [
  { id: "WINDOW_FROM_SOURCE", findings: (steps, ctx, design) => steps.filter((s) => WINDOWED.some((c) => isOp(s, c)) && requestOf(s).waitMs !== undefined && !witnesses(design, s.i)).map((s) => `step ${s.i} sets its own window — a window is compiled from an accepted criterion's within, never proposed (only a control's witness waits within its own bound, and it can only ever make a run inconclusive)`) },
  { id: "CLOCK_INJECTABLE", findings: (steps, ctx) => steps.filter((s) => isOp(s, "orbit.clock.advance") && !meets(ctx.semanticsOf?.(s.i) ?? {}, { clockInjection: ["live", "restart"] }).met.length).map((s) => `step ${s.i} moves a business clock through an adapter that does not say it can inject one — real time, or a gap`) },
  { id: "NO_VERDICT_TEXT", findings: (steps) => steps.filter((s) => VERDICT_TEXT.some((k) => s.step?.[k] !== undefined)).map((s) => `step ${s.i} carries ${VERDICT_TEXT.filter((k) => s.step[k] !== undefined).join(" and ")} — a skeleton proposes steps; the engine compiles every verdict`) },
];

const witnesses = (design, i) => (design?.controls ?? []).some((c) => c.step === i);

export const temporalFindings = (design, ctx = {}) => {
  const steps = stepsOf(design);
  return TEMPORAL_RULES.flatMap((rule) => rule.findings(steps, ctx, design).map((say) => ({ rule: rule.id, say })));
};
