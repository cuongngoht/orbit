// What a provider needs of the machine: the Process port, the probe, the Reach port, the checkout,
// the environment's NAMES to pass on, a way to wait -- and, in a sandbox, its scratch room. One place, so the start, the stop, the
// status, a preparation and a connectivity check all hand a provider the same ports.
//
// `providers` is handed in so a provider that DELEGATES (a sandbox places each component on another
// provider) finds its backing without importing the registry it is a row of.
export const deps = (ctx, extra = {}) => ({ process: ctx.process, probe: ctx.probe, reach: ctx.reach, root: ctx.root, env: ctx.env ?? {}, now: ctx.clock, sleep: ctx.sleep, providers: ctx.providers, isolation: ctx.isolation, scratch: ctx.scratch ?? null, ...extra });

// Which sessions of the live room a context speaks about: a person's runtime, or one task's sandbox
// (src/runtime/sessions.mjs ENV_SCOPE). A fake context with no owner is a person's.
export const scopeOf = (ctx) => ({ env: ctx.envId, owner: ctx.owner ?? { kind: "human" } });
