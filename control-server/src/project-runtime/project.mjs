// WHICH checkout a runtime route is about: the one its path names -- project AND checkout, both --
// and no other. It is never "the project Control was started from", and nothing in a request body
// can name a directory: the path holds two identities, the registry says where that checkout is,
// and an identity the registry does not know is a 404, however well formed.
//
// What binds it is the SAME binding cli/runtime.mjs uses, pointed at that checkout, so the page
// and the terminal cannot disagree about a machine.
import { bindRuntime, bindSandbox } from "../core.mjs";
import { conflict, missing } from "../errors.mjs";
import { registryOf } from "../projects/read.mjs";

export function checkoutOf(ctx, [key, checkout]) {
  const found = registryOf(ctx).find(key, checkout);
  if (!found) throw missing("PROJECT_UNKNOWN", "no project and checkout like that is known on this machine");
  if (!found.checkout.exists) throw conflict("CHECKOUT_MISSING", "that checkout's directory is not there any more: restore it, or stop using it from Orbit");
  return found;
}

function sameCheckout(bound, found) {
  if (bound.project.storeKey === found.project.key && bound.checkout === found.checkout.id) return bound;
  throw conflict("CHECKOUT_CHANGED", "that directory is not the project and checkout it was when Orbit last saw it: open the project again from its checkout");
}

// -> the runtime context for the checkout the path names.
export function runtimeOf(ctx, ids) {
  const found = checkoutOf(ctx, ids);
  return sameCheckout(bindRuntime({ pluginRoot: ctx.world.pluginRoot, env: ctx.world.env, cwd: found.checkout.root }), found);
}

// -> the runtime context of the SANDBOX `task` owns in the checkout the path names: that checkout's own
// context, re-rooted on the task's workspace (skills/orbit-runtime/bind.mjs). The task is the
// caller's to have proved -- from the task's own journal -- and is never read from a body.
export function sandboxOf(ctx, ids, task) {
  const found = checkoutOf(ctx, ids);
  return sameCheckout(bindSandbox({ pluginRoot: ctx.world.pluginRoot, env: ctx.world.env, cwd: found.checkout.root, task }), found);
}
