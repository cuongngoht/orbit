// Which actions need a PERSON before they run -- rows, never a branch per kind.
//
// 1.7.8 gates one thing: invoking a project capability that DECLARES it changes state outside the
// workspace. Everything else the orchestrator does either writes only the task's own workspace or
// store, or is delegated to an owner with gates of its own (runtime start is `approval: none` in
// runtime's table, and runtime's human-only operations are never called from here).
//
// A gated action is asked for with `request-approval` -- type, tool, environment and params, the
// params hashed into the fingerprint and never kept -- and runs only when a person granted that
// exact fingerprint in Orbit Control, once. The approval is consumed by the task's own rules when
// the action starts. Nothing here can grant one.

// A WORD the task accepts as an environment: where the action would land.
const word = (s) => String(s ?? "").replace(/[^A-Za-z0-9_-]/g, "-").replace(/^[^A-Za-z]+/, "").slice(0, 40) || "local";

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9.-]/g, "-").slice(0, 64);

export const GATED = [
  {
    kind: "invoke",
    when: (a, cap) => cap?.mutates === true,
    ask: (a, cap) => ({ type: "capability.invoke", tool: slug(a.capability), environment: word(cap.connection), params: { capability: a.capability, input: a.input ?? {} } }),
    risk: (a) => `${a.capability} declares that it changes state outside the task's workspace`,
  },
];

// -> { type, tool, environment, params, risk } when the action needs a person, else null.
// `describe(id)` is the capability port's: what a capability declares, or null.
export function gateOf(kind, a, describe) {
  const cap = kind === "invoke" ? describe?.(a.capability) ?? null : null;
  const row = GATED.find((g) => g.kind === kind && g.when(a, cap));
  return row ? { ...row.ask(a, cap), risk: row.risk(a) } : null;
}
