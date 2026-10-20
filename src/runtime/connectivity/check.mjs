// CHECK: can a server a person configured be reached -- asked from WHERE a component would run.
//
// The one operation behind `runtime check`, `runtime retry`, Orbit Control's Check once and Retry, and a
// start's before-start gate (src/runtime/lifecycle/start.mjs): a target is named by its ID and read
// from the settings a person saved, never handed in as a host -- which is what keeps a request body
// from turning this into a way to knock on any machine. Each location it is checked from is asked
// on its own, through that location's provider (`reach`), and its answer is never copied to another:
// the host reaching a database behind a VPN says nothing about the dev container reaching it.
//
// `check` is ONE attempt per location; `retry` is the saved policy -- bounded, and stopped at once on
// an answer that settles it (./retry.mjs). Either way what it came to is kept (./observations.mjs) and
// returned in the same shape `runtime connectivity` reads back.
import { Refused } from "../../errors.mjs";
import { deps } from "../lifecycle/deps.mjs";
import { worldOf } from "../lifecycle/world.mjs";
import { providerOf } from "../providers/index.mjs";
import { look } from "../understanding.mjs";
import { CONNECTIVITY_FRESH_MS, aged, current, observationOf } from "./observations.mjs";
import { retried } from "./retry.mjs";
import { stateOf } from "./states.mjs";
import { isAddress, targetNamed, targetsOf } from "./targets.mjs";

// The code a refusal for a target nobody configured carries, so Orbit Control can say 404.
export const TARGET_UNKNOWN = "TARGET_UNKNOWN";

export const MODES = ["check", "retry"];

// What a target is, as a reader is shown it -- never more than settings hold.
const briefOf = (t) => ({ id: t.id, label: t.label, host: t.host, port: t.port, protocol: t.protocol, requiredBy: t.requiredBy, checkFrom: t.checkFrom, beforeStart: t.beforeStart, retry: t.retry, ...(t.note ? { note: t.note } : {}) });

const byLocation = (observations) => Object.fromEntries(observations.map((o) => [o.provider, o]));

// -> { retry, freshMs, targets: [{ ...target, observations: { <location>: observation } }] }. Reads; asks nothing.
export function connectivityNow(ctx) {
  const settings = ctx.readSettings().settings;
  const targets = targetsOf(settings);
  const seen = current(ctx.observations.list(), targets, ctx.clock());
  return { retry: settings.connectivity.retry, freshMs: CONNECTIVITY_FRESH_MS, targets: targets.map((t, i) => ({ ...briefOf(t), observations: byLocation(seen[i].locations) })) };
}

// -> { target, mode, results: { <location>: observation } }
export async function checkTarget(ctx, id, { providers, mode = "check" } = {}) {
  const asked = prepared(ctx, id, providers, mode);
  const results = [];
  for (const provider of asked.from) results.push(await reachedFrom(ctx, asked.target, provider, asked.policy, asked.world));
  return { target: briefOf(asked.target), mode, results: byLocation(results) };
}

function prepared(ctx, id, providers, mode) {
  const settings = ctx.readSettings().settings;
  const target = named(targetsOf(settings), id);
  return { target, from: locationsOf(target, providers), policy: mode === "retry" ? target.retry : { ...target.retry, attempts: 1 }, world: worldOf(ctx, look(ctx).view, settings, { probe: false, host: false }) };
}

function named(targets, id) {
  if (!id) throw new Refused("name a target: runtime check <target> [--from=native|devcontainer] — `runtime connectivity` lists them");
  const target = targetNamed(targets, id);
  if (!target) throw Object.assign(new Refused(`no connectivity target ${JSON.stringify(id)} is set for this machine: \`runtime connectivity\` lists them, and \`runtime configure --reach=<id> --address=<host> --port=<port> --human\` adds one`), { code: TARGET_UNKNOWN });
  return target;
}

function locationsOf(target, providers) {
  const asked = (providers ?? []).filter(Boolean);
  const elsewhere = asked.filter((p) => !target.checkFrom.includes(p));
  if (elsewhere.length) throw new Refused(`${target.id} is checked from ${target.checkFrom.join(", ")} — not from ${elsewhere.join(", ")}`);
  return asked.length ? asked : target.checkFrom;
}

// One target, from one location, with a policy -- and what it came to, kept and returned as it is
// kept. The same path a start's gate takes.
export async function reachedFrom(ctx, target, providerId, policy, world) {
  const provider = providerOf(providerId, ctx.providers);
  const done = await retried(() => attemptFrom(ctx, provider, providerId, target, policy, world), policy, { sleep: ctx.sleep, now: ctx.clock });
  const kept = ctx.observations.note(observationOf(target, providerId, done));
  return { ...kept, freshness: aged(kept, ctx.clock()) };
}

async function attemptFrom(ctx, provider, providerId, target, policy, world) {
  if (!provider?.reach) return { state: "UNKNOWN", resolution: "UNKNOWN", transport: "NOT_ATTEMPTED", because: `${providerId} has no way to ask from where it runs things` };
  const answer = addressed(target, await guarded(() => provider.reach(target, world, deps(ctx, { timeoutMs: policy.timeoutMs }))));
  return { ...answer, state: stateOf(answer) };
}

// An ADDRESS needs no lookup: whatever a place says about resolving one -- every resolver hands an
// address straight back -- nothing was looked up, and DNS was not part of the answer.
const addressed = (target, answer) => (isAddress(target.host) ? { ...answer, resolution: "NOT_ATTEMPTED" } : answer);

// A provider's own failure is an answer nobody could give -- UNKNOWN, with its words -- never a crash
// of the check of every other location.
async function guarded(ask) {
  try {
    return await ask();
  } catch (e) {
    return { resolution: "UNKNOWN", transport: "NOT_ATTEMPTED", because: `the check could not be made (${e?.message ?? e})` };
  }
}
