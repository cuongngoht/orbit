// DOCTOR and PREPARE: what is true here, and what making a way of running things
// ready would take.
//
// DOCTOR asks the machine -- the tools this checkout's requirements name, and the
// container host's when a container is in play -- and says what each provider
// concludes. It changes nothing and starts nothing. PREPARE is a PLAN until it is
// told otherwise: what a host is missing, what an environment would need built, and
// that the repository is untouched. With `apply` it does the slow part -- bringing
// an environment up -- and that is a command of its own because it spends the
// machine's time and can pull images.
//
// Neither installs a thing on the host. A tool that is missing is a line saying
// what to install, and Orbit installing nothing is the point: what the container
// provides is the ENVIRONMENT's, and never installed on the host because a
// container wants it.
import { blockedWithout } from "../validate.mjs";
import { look } from "../understanding.mjs";
import { planned } from "./world.mjs";
import { deps } from "./deps.mjs";

export function doctor(ctx) {
  const understanding = look(ctx);
  const { world, plan } = planned(ctx, understanding, ctx.readSettings().settings, { probe: true });
  return { understanding: { state: understanding.state }, machine: { platform: world.machine.platform, arch: world.machine.arch, tools: world.machine.tools, asked: world.tools }, providers: ctx.providers.map((p) => p.doctor(world)), plan };
}

// -> { apply, plans, applied? }
export function prepare(ctx, args) {
  const understanding = look(ctx);
  const { world } = planned(ctx, understanding, ctx.readSettings().settings, { probe: args.apply === true });
  const plans = ctx.providers.map((p) => p.prepare(world, deps(ctx)));
  return args.apply ? { apply: true, plans, applied: applied(ctx, world) } : { apply: false, plans };
}

// Only a provider whose plan has environment steps is applied -- and only the one a
// person has an environment for.
function applied(ctx, world) {
  const instance = ctx.instances.list().find((i) => i.provider === "devcontainer");
  if (!instance) return [{ provider: "devcontainer", ok: false, because: "there is no environment to prepare: design and adopt one first" }];
  return [brought(ctx, { ...world, envId: instance.id })];
}

function brought(ctx, world) {
  const provider = ctx.providers.find((p) => p.id === "devcontainer");
  blockedWithout(provider, world);
  const done = provider.prepare(world, deps(ctx), { apply: true });
  return { provider: "devcontainer", ok: done.ok, because: done.because, receipt: done.receipt };
}
