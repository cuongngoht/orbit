// STOP: end what Orbit started, and only that.
//
// The one operation that can do harm to something that is not Orbit's, so it is the
// most guarded. A session is stopped when -- and only when -- its ownership is
// PROVEN right now (src/runtime/ownership.mjs): a receipt, a pid and a start time
// that all agree. Everything else is refused, and each refusal says which fact is
// missing and what a person can do:
//
//   ORBIT_OWNED + running   stopped: TERM to the process group, a grace period, then KILL,
//                          each time asked of the OS rather than assumed
//   gone                   the process is no longer there: the receipt is closed, nothing killed
//   pid reused             the pid is another program's now: the receipt is closed as LOST,
//                          and nothing is killed
//   EXTERNAL / UNKNOWN     refused, never stopped. A start that never settled is released
//                          by a PERSON (`--release`, with --human), which closes the receipt
//                          and kills nothing
//
// Never by name, never by port, never `pkill`: a process is found by its receipt.
import { Refused } from "../../errors.mjs";
import { judge, mayStop } from "../ownership.mjs";
import { providerOf } from "../providers/index.mjs";
import { deps, scopeOf } from "./deps.mjs";

const OPEN = ["RUNNING", "STARTING", "AMBIGUOUS"];

function selected(ctx, args) {
  const open = ctx.sessions.list(scopeOf(ctx)).filter((s) => OPEN.includes(s.state));
  if (args.session && !ctx.sessions.read(args.session)) throw new Refused(`no session ${args.session} is kept for this checkout`);
  if (args.session && !open.some((s) => s.id === args.session) && inOtherScope(ctx, args.session)) throw new Refused(`session ${args.session} belongs to another environment than this one (a person's runtime and each task's sandbox are separate), so it is not stopped from here`);
  return open.filter((s) => (!args.session || s.id === args.session) && (!args.component || s.component === args.component));
}

const inOtherScope = (ctx, id) => ctx.sessions.all().some((s) => s.id === id && OPEN.includes(s.state));

const closed = (ctx, session, state, how) => {
  ctx.sessions.write({ ...session, state, stoppedAt: new Date(ctx.clock()).toISOString(), stoppedHow: how });
};

// -> { stopped, gone, refused, released, environment }
export async function stop(ctx, args) {
  if (args.release) return released(ctx, args);
  const results = [];
  for (const s of selected(ctx, args)) results.push(await stopOne(ctx, s));
  const environment = args.environment ? down(ctx) : null;
  return { stopped: results.filter((r) => r.outcome === "stopped"), gone: results.filter((r) => ["gone", "lost"].includes(r.outcome)), refused: results.filter((r) => r.outcome === "refused"), released: [], environment };
}

// What the OS says of the process a receipt names: through its provider, and -- for a receipt whose
// provider this engine does not have -- from the OS alone, which is all that judging ownership needs.
const observation = (ctx, provider, session) => (provider ? provider.status(session, deps(ctx)) : { alive: ctx.process.alive(session.pid), startedAt: ctx.process.startedAtOf(session.pid) });

async function stopOne(ctx, session) {
  const provider = providerOf(session.provider, ctx.providers);
  const judgement = judge(session, observation(ctx, provider, session));
  const base = { session: session.id, component: session.component, ownership: judgement.ownership, why: judgement.why };
  return { ...base, ...(await decided(ctx, session, provider, judgement)) };
}

async function decided(ctx, session, provider, judgement) {
  if (["GONE", "PID_REUSED"].includes(judgement.rule)) return { outcome: closedAs(ctx, session, judgement) };
  if (!provider) return { outcome: "refused", why: `its provider (${session.provider}) is not one this engine has, so it is not stopped here` };
  return mayStop(judgement) ? halted(ctx, session, provider) : refusedWith(session, judgement);
}

function refusedWith(session, judgement) {
  const unsettled = ["AMBIGUOUS", "STARTING"].includes(session.state);
  return { outcome: "refused", why: `${judgement.why}${unsettled ? `; a person releases it with --release=${session.id} --human` : ""}` };
}

// The process is not there, or is another program's now: the receipt is closed and
// nothing is killed.
function closedAs(ctx, session, judgement) {
  const outcome = judgement.state === "STOPPED" ? "gone" : "lost";
  closed(ctx, session, outcome === "gone" ? "STOPPED" : "LOST", outcome === "gone" ? "it had already exited" : "the pid was reused");
  return outcome;
}

async function halted(ctx, session, provider) {
  const done = await provider.stop(session, deps(ctx));
  if (done.ok) closed(ctx, session, "STOPPED", done.how);
  return done.ok ? { outcome: "stopped", how: done.how, residual: done.residual ?? null } : { outcome: "refused", why: `it would not stop (${done.why ?? done.how})` };
}

// A PERSON closes a receipt that cannot be proven -- a start that never settled, a
// process the OS would not date. It kills nothing, and it refuses a process that IS
// running and Orbit's: that one is stopped, not released.
function released(ctx, args) {
  if (!args.human) throw new Refused("releasing a session is a person's — relay it with --human");
  const target = selected(ctx, { session: args.release });
  const out = target.map((s) => releaseOne(ctx, s));
  return { stopped: [], gone: [], refused: out.filter((o) => o.outcome === "refused"), released: out.filter((o) => o.outcome === "released"), environment: null };
}

function releaseOne(ctx, session) {
  const provider = providerOf(session.provider, ctx.providers);
  const judgement = judge(session, observation(ctx, provider, session));
  if (mayStop(judgement)) return { session: session.id, outcome: "refused", why: "it is running and Orbit's own: stop it instead of releasing it" };
  closed(ctx, session, "LOST", "released by a person");
  return { session: session.id, component: session.component, outcome: "released", why: judgement.why };
}

// The environment's CONTAINER, by the labels Orbit gave it -- never by name.
function down(ctx) {
  const instance = ctx.instances.list().find((i) => i.provider === "devcontainer");
  if (!instance) return { ok: true, because: "there is no environment" };
  const provider = providerOf("devcontainer", ctx.providers);
  return provider.down({ checkout: ctx.checkout, envId: instance.id }, deps(ctx));
}
