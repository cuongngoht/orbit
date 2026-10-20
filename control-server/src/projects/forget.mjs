// A person forgets a checkout whose directory is gone: relayed as `human: true` from the button a
// person pressed, for the checkout the path names in the project the path names. The engine's own
// command does it -- its line and its binding, nothing else -- and refuses one that is there again
// (409: it moved since the page listed it). What Orbit kept about it stays in the store.
import { RUNTIME_COMMANDS } from "../core.mjs";
import { guarded, invalid, missing } from "../errors.mjs";
import { fieldsOf } from "../project-runtime/body.mjs";
import { registryOf } from "./read.mjs";

export function forgetCheckout(ctx, ids, body) {
  const [key, checkout] = ids;
  const given = fieldsOf(body, { human: "boolean" });
  if (given.human !== true) throw invalid("HUMAN_REQUIRED", "forgetting a checkout is a person's: send { human: true } from the button a person pressed");
  if (!registryOf(ctx).find(key, checkout)) throw missing("PROJECT_UNKNOWN", "no project and checkout like that is known on this machine");
  return guarded("PROJECT_FORGET_FAILED", () => RUNTIME_COMMANDS.forget.run({ registry: registryOf(ctx) }, [checkout, "--human"]));
}
