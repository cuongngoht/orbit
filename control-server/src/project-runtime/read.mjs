// A checkout's runtime, READ: what it needs, whether this machine can run it, what is running and
// whether it answers -- and what a person has set. Reading starts nothing, probes no tool and
// writes nothing: the same `status` the CLI prints (src/runtime/lifecycle/status.mjs), which asks
// only whether a recorded process is still there and whether a running component answers where it
// says it listens.
import { RUNTIME_COMMANDS } from "../core.mjs";
import { guarded, invalid } from "../errors.mjs";
import { runtimeOf } from "./project.mjs";

const CODE = "RUNTIME_UNAVAILABLE";

export const runtimeStatus = (ctx, ids) => guarded(CODE, () => RUNTIME_COMMANDS.status.run(runtimeOf(ctx, ids), []));

export const runtimeSettings = (ctx, ids) => guarded(CODE, () => RUNTIME_COMMANDS.settings.run(runtimeOf(ctx, ids), []));

// What each reach target LAST answered, from each location, with its age: what is kept, and nothing
// asked -- opening the page never makes a connection to anything.
export const runtimeConnectivity = (ctx, ids) => guarded(CODE, () => RUNTIME_COMMANDS.connectivity.run(runtimeOf(ctx, ids), []));

const PROPOSAL = /^ep-[a-f0-9]{12}$/;

export function runtimeProposal(ctx, ids) {
  const [, , proposal] = ids;
  if (!PROPOSAL.test(proposal)) throw invalid("INVALID_PROPOSAL_ID", "a proposal id looks like ep- and twelve hexadecimal characters");
  return guarded(CODE, () => RUNTIME_COMMANDS.proposal.run(runtimeOf(ctx, ids), [proposal]));
}
