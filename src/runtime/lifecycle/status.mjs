// STATUS: everything a person -- or Orbit Control -- needs to see about one
// checkout's runtime, in one read.
//
// Read-only in the strict sense: it writes nothing, runs no tool and spawns no
// process. What it DOES ask is local and cheap and about things already running:
// whether each recorded process is still there and since when, and whether a
// running component answers where it says it listens -- a loopback connection,
// and only for something Orbit or a person has started. Nothing here discovers,
// designs or probes a tool: those are their own commands, and a status that
// quietly did them would make "look" and "act" one thing.
//
// What it assembles, each from its own module and none decided here (and the
// verification projection, src/runtime/verification.mjs, over all of it):
//   understanding   whether the evidence has been read and is current
//   plan            how each component would run on this machine, or why it cannot
//   sessions        what was started, judged against the OS now, with readiness
//   services        the servers the project is defined with, and whether they answer
//   instances       the environments, as they are on the disk NOW
//   proposals       what is open to review
//   settings        this machine's, and whether other machines set any
//   external        with reuse allowed: a component Orbit is not running whose expected readiness
//                   answers here anyway -- EXTERNAL, somebody else's, never stopped
//   connectivity    what each reach target last answered from each location, with its age. KEPT
//                   answers only: a status never asks the network, and an old one says STALE
import { hinted, probeFor, readiness, startedWith } from "../readiness.mjs";
import { providerOf } from "../providers/index.mjs";
import { look } from "../understanding.mjs";
import { project } from "../verification.mjs";
import { planned, instancesNow } from "./world.mjs";
import { connectivityNow } from "../connectivity/check.mjs";
import { deps } from "./deps.mjs";
import { sessionsNow } from "./start.mjs";

export async function status(ctx) {
  const understanding = look(ctx);
  const settings = ctx.readSettings();
  const { world, plan } = planned(ctx, understanding, settings.settings, { probe: false });
  const sessions = await sessionsView(ctx, understanding.view, sessionsNow(ctx));
  return assembled(ctx, { understanding, settings, world, plan, sessions });
}

async function assembled(ctx, a) {
  const verification = project({ plan: a.plan, sessions: a.sessions, view: a.understanding.view, browser: browserOf(ctx), capabilities: ctx.capabilities() });
  return { checkout: checkoutOf(ctx), understanding: understandingOf(a.understanding), plan: a.plan, sessions: a.sessions, external: await externalOf(ctx, a), services: await servicesOf(ctx, a.understanding.view), instances: instancesNow(ctx), proposals: ctx.proposals.list().filter((p) => p.status === "open").map(briefOf), settings: a.settings, machine: a.world.machine, worldTools: a.world.tools, connectivity: connectivityNow(ctx), verification };
}

// A component Orbit is not running, whose readiness a PERSON set, answering here anyway -- shown only
// when reuse is allowed, because that is when it matters: a start would reuse it, never own it.
async function externalOf(ctx, a) {
  const set = a.settings.settings;
  const ours = new Set(a.sessions.filter((s) => s.state === "RUNNING").map((s) => s.component));
  const asked = set.reuseExternal ? a.plan.components.filter((c) => c.state !== "not-startable" && !ours.has(c.key) && set.components?.[c.key]?.readiness) : [];
  return answering(ctx, asked, a.understanding.view, set);
}

async function answering(ctx, components, view, set) {
  const out = [];
  for (const c of components) out.push({ component: c.key, provider: c.provider, ownership: "EXTERNAL", readiness: await readiness(true, probeFor(view.components.find((v) => v.key === c.key), set.components[c.key].readiness, null), deps(ctx)) });
  return out.filter((e) => e.readiness.state === "READY");
}

// The tool that drives a browser is whichever row of the tool catalog provides that
// capability -- named by the composition root, never here.
const browserOf = (ctx) => (ctx.browserTool ? ctx.machine.cached([ctx.browserTool])[ctx.browserTool] : null);

const checkoutOf = (ctx) => ({ id: ctx.checkout, root: ctx.root, name: ctx.name, host: ctx.host, branch: ctx.source.branch(), commit: ctx.source.commit() });

function understandingOf(u) {
  return { state: u.state, facts: u.facts.length, at: u.model?.at ?? null, commit: u.model?.commit ?? null, branch: u.model?.branch ?? null, unknowns: u.model?.unknowns ?? [], gaps: u.model?.gaps ?? [], stale: u.stale ?? [], dirty: u.dirty ?? [], added: u.added ?? [], removed: u.removed ?? [] };
}

const briefOf = (p) => ({ id: p.id, state: p.state, because: p.because, createdAt: p.createdAt });

// Each session as it is NOW, with readiness for the ones that are up.
async function sessionsView(ctx, view, judged) {
  const out = [];
  for (const { session, judgement } of judged) out.push(await sessionView(ctx, view, session, judgement));
  return out.reverse();
}


async function sessionView(ctx, view, session, judgement) {
  const component = view.components.find((c) => c.key === session.component);
  const up = judgement.state === "RUNNING";
  const probe = component ? probeFor(component, ctx.readSettings().settings.components?.[component.key]?.readiness ?? null, startedWith(component, session)) : null;
  const ready = up ? hinted(await readiness(true, probe, deps(ctx)), providerOf(session.provider, ctx.providers)) : { state: "NOT_RUNNING" };
  return { id: session.id, component: session.component, provider: session.provider, ...(session.executionProvider ? { executionProvider: session.executionProvider, sourceTree: session.sourceTree ?? null } : {}), requestedAt: session.requestedAt, state: judgement.state, ownership: judgement.ownership, why: judgement.why, pid: session.pid, startedAt: session.startedAt, ports: session.ports ?? [], readiness: ready, logs: ctx.sessions.logs(session.id) };
}

// The servers a project is defined with, and whether anything answers where each
// says it listens. Orbit does not start them natively; it says whether they are there.
async function servicesOf(ctx, view) {
  const out = [];
  for (const s of view.services) out.push({ service: s.service, name: s.name, image: s.image, port: s.port, reachable: s.port ? (await ctx.probe.tcp(s.port)).ok : null });
  return out;
}
