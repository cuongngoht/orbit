import { enterIdentity } from "../identity.mjs";

export function identityGate(ctx, run) {
  if (run.c.identity) enterIdentity(ctx, run, run.c.identity);
}
