// STARTING a sandbox: prepare it (idempotently), end what it ran of an older tree, and start what it placed.
//
// `sandbox-start` is the one step the orchestrator takes to get a running application, so it does what has to
// precede one rather than leaving that to a second step that can be forgotten: a sandbox that is not prepared is
// prepared (a prepared one costs a fingerprint), and a session of THIS sandbox that was built from another tree
// is ended and replaced -- never reused, because a session that survives a change is exactly the evidence this
// exists to refuse. It only ever ends sessions the sandbox owns, by the ownership rules every stop passes.
import { Blocked } from "../../errors.mjs";
import { scrub } from "../../scrub.mjs";
import { sessionsNow, start } from "../lifecycle/start.mjs";
import { stop } from "../lifecycle/stop.mjs";
import { planned } from "../lifecycle/world.mjs";
import { look } from "../understanding.mjs";
import { effectivePolicy } from "./policy.mjs";
import { prepared } from "./prepare.mjs";
import { isolatedLaunched } from "./isolated-launch.mjs";

// How long a start waits for what it started to answer or to stop: an agent needs to know whether it came up.
export const WAIT_SECONDS = 30;

const EXIT_LINES = 40;

// Who has to act for a start that could not go on, from the sentence it was blocked with. Ordered; the last
// always matches. (A port somebody else holds and a server nobody can reach are a person's; the rest is the
// machine's.)
const NEEDS_OF = [
  { when: /is in use by|is not reachable from/, needs: "person" },
  { when: /./, needs: "environment" },
];

const needsOf = (sentence) => NEEDS_OF.find((r) => r.when.test(sentence)).needs;

// The sessions of this sandbox still running something built from another tree, ended: the replaced.
async function replacing(ctx, tree) {
  const old = sessionsNow(ctx).filter((s) => s.judgement.state === "RUNNING" && s.session.sourceTree !== tree).map((s) => s.session);
  const done = [];
  for (const s of old) done.push({ component: s.component, session: s.id, result: await stop(ctx, { session: s.id }) });
  return { replaced: done.filter((d) => d.result.stopped.length || d.result.gone.length).map(({ component, session }) => ({ component, session })), refused: done.filter((d) => d.result.refused.length).map((d) => ({ component: d.component, because: d.result.refused[0].why })) };
}

async function attempted(ctx, args) {
  const plannedNow = planned(ctx, look(ctx), ctx.readSettings().settings, { probe: true });
  try {
    return { done: await start(ctx, plannedNow, { component: args.component, wait: args.wait ?? WAIT_SECONDS }) };
  } catch (e) {
    if (e instanceof Blocked) return { stuck: e.message };
    throw e;
  }
}

const tailOf = (text) => scrub(String(text ?? "")).split("\n").filter((l) => l.trim()).slice(-EXIT_LINES);

const exitedOf = (ctx, r) => ({ component: r.component, session: r.session, status: null, lines: [...tailOf(ctx.io.read(ctx.sessions.logs(r.session).err)), ...tailOf(ctx.io.read(ctx.sessions.logs(r.session).out))].slice(-EXIT_LINES) });

const startedOf = (ctx, r) => ({ component: r.component, session: r.session, executionProvider: ctx.sessions.read(r.session)?.executionProvider ?? null, requestedAt: ctx.sessions.read(r.session)?.requestedAt ?? null });

const NOTHING = { started: [], reused: [], skipped: [], blocked: [], notReady: [] };

const blockedOf = (b) => ({ component: b.component, because: b.blocking.join("; "), needs: needsOf(b.blocking.join("; ")) });

const exited = (r) => r.readiness?.exited === true;

function answered(ctx, prep, swap, got) {
  const done = got.done ?? NOTHING;
  const stuck = got.stuck ? [{ component: "*", because: got.stuck, needs: needsOf(got.stuck) }] : [];
  return { environment: ctx.envId, tree: prep.tree, started: done.started.filter((r) => !exited(r)).map((r) => startedOf(ctx, r)), reused: done.reused.map((r) => ({ component: r.component })), skipped: done.skipped.map((r) => ({ component: r.component, session: r.session })), replaced: swap.replaced, exited: done.started.filter(exited).map((r) => exitedOf(ctx, r)), blocked: [...done.blocked.map(blockedOf), ...swap.refused.map((r) => ({ ...r, needs: "person" })), ...stuck], notReady: done.started.filter((r) => r.readiness?.state === "NOT_READY").map((r) => ({ component: r.component, because: r.readiness.because })), endpoints: ctx.sandboxes.read(ctx.envId)?.endpoints ?? [] };
}

const unprepared = (ctx, prep) => ({ ...answered(ctx, prep, { replaced: [], refused: [] }, { stuck: prep.blocked.because }), blocked: [{ component: "*", because: prep.blocked.because, needs: prep.blocked.needs }], state: "BLOCKED" });

// An ISOLATED sandbox starts its components in containers of their own (src/runtime/sandbox/isolated-launch.mjs).
const isolatedSandbox = (ctx) => effectivePolicy(ctx.readSettings().settings).policy.isolation.mode === "required";

const touched = (ctx) => ctx.sandboxes.write({ ...ctx.sandboxes.read(ctx.envId), lastActiveAt: ctx.now() });

// -> { environment, tree, started, reused, skipped, replaced, exited, blocked, notReady, endpoints }
export async function launched(ctx, args, deps) {
  const prep = await prepared(ctx, deps);
  if (prep.state !== "READY") return unprepared(ctx, prep);
  return isolatedSandbox(ctx) ? (touched(ctx), isolatedLaunched(ctx, args, deps, prep)) : placedLaunched(ctx, args, deps, prep);
}

async function placedLaunched(ctx, args, deps, prep) {
  const swap = await replacing(ctx, prep.tree);
  const got = swap.refused.length ? {} : await attempted(ctx, args);
  return (touched(ctx), answered(ctx, prep, swap, got));
}
