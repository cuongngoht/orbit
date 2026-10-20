import { replan, retryUnit } from "./replan-respond.mjs";

export const TRIGGERS = [
  { id: "UNIT_FAILED", at: "failed", response: "retry-unit", when: (c) => c.unit?.state === "failed", say: (c) => `${c.unit.id} failed — planned again with the same acceptance links` },
  { id: "REQUIREMENT_CHANGED", at: "settled", response: "replan", when: (c) => c.requirementMoved === true, say: () => "requirement moved — work units replanned from analysis" },
  { id: "STALE_EVIDENCE", at: "settled", response: "invalidate-ac", when: (c) => (c.staleAcs ?? []).length > 0, say: (c) => `${c.staleAcs.length} acceptance criterion evidence is stale` },
  { id: "BUDGET_EXHAUSTED", at: "blocked", response: "block", when: (c) => (c.replans ?? 0) >= (c.maxReplans ?? 8), say: () => "replan budget exhausted" },
  { id: "NONE", at: "settled", response: "none", when: () => true, say: () => "nothing asks for a new plan" },
];

const HANDLERS = {
  block: (row, ctx) => ({ trigger: row.id, response: "block", because: row.say(ctx) }),
  replan: (row, ctx) => replan(ctx, row),
  "retry-unit": (row, ctx) => retryUnit(ctx, row),
  "invalidate-ac": (row, ctx) => ({ trigger: row.id, response: "invalidate-ac", staleAcs: ctx.staleAcs }),
  none: (row) => ({ trigger: row.id, response: "none" }),
};

export function respond(ctx) {
  const row = TRIGGERS.find((t) => t.at === ctx.at && t.when(ctx));
  if (!row) return { trigger: "NONE", response: "none" };
  return HANDLERS[row.response]?.(row, ctx) ?? { trigger: row.id, response: "none" };
}
