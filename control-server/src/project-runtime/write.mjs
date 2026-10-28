// A checkout's runtime, CHANGED -- each operation the CLI's command of the same name, over the same
// binding, with arguments built here from the few fields a body may carry.
//
//   discover · design   change this machine's store, and nothing in the repository
//   doctor              asks this machine's tools
//   prepare             a PLAN of what bringing an environment up would take; it acts on nothing
//   validate            brings the environment up -- builds it on this machine, where its own
//                       definition may run commands -- so it is a person's, like adopting
//   start · stop        launch what a file declared, end what Orbit can prove it started
//   adopt               the ONE operation that writes the repository: a person's, relayed with
//                       `human: true` from an explicit button, for a proposal still true
//   settings            a person's preference among the ways that work, against the revision read
//   check · retry       one attempt / the saved retry policy at a reach target a PERSON configured,
//                       from where it is checked from. The target is named by its ID in the path,
//                       and the host and port are the setting's -- a body chooses only a location,
//                       so a request can never point a check at a host of its own
//
// What none of them can do is what the CLI cannot: no command comes from a body, no process is
// ended that Orbit cannot prove is its own, and no setting makes an incompatible way compatible.
// A receipt is not a verdict, and a long operation is awaited with its own deadline and answered
// as a receipt -- the page shows it and reads again.
import { keepRuntimeSettings, RUNTIME_COMMANDS } from "../core.mjs";
import { guarded, invalid } from "../errors.mjs";
import { fieldsOf, flagsOf } from "./body.mjs";
import { runtimeOf } from "./project.mjs";

const CODE = "RUNTIME_OPERATION_FAILED";

const BODIES = {
  discover: { dry: "boolean", rescan: "boolean" },
  design: {},
  doctor: {},
  prepare: {},
  validate: { human: "boolean" },
  start: { component: "name", wait: "seconds" },
  stop: { component: "name", session: "name", environment: "boolean" },
};

// What only a person's word may start: relayed as `human: true` from the button a person pressed.
const PERSONAL = new Set(["validate"]);

function relayed(name, given) {
  if (PERSONAL.has(name) && given.human !== true) throw invalid("HUMAN_REQUIRED", `${name} brings an environment up on this machine, and its definition may run commands of its own there: it is a person's — send { human: true } from the button a person pressed`);
  return given;
}

// The operation `name`: validate the body, build the CLI's own arguments, run its command.
function operation(name) {
  return (ctx, ids, body) => {
    const spec = BODIES[name];
    const args = flagsOf(relayed(name, fieldsOf(body, spec)), spec);
    return guarded(CODE, () => RUNTIME_COMMANDS[name].run(runtimeOf(ctx, ids), args));
  };
}

export const discoverRuntime = operation("discover");
export const designEnvironment = operation("design");
export const doctorRuntime = operation("doctor");
export const prepareRuntime = operation("prepare");
export const validateRuntime = operation("validate");
export const startRuntime = operation("start");
export const stopRuntime = operation("stop");

const PROPOSAL = /^ep-[a-f0-9]{12}$/;

export function adoptProposal(ctx, ids, body) {
  const [, , proposal] = ids;
  const given = fieldsOf(body, { human: "boolean" });
  if (given.human !== true) throw invalid("HUMAN_REQUIRED", "adopting an environment writes the repository, and is a person's: send { human: true } from the button a person pressed");
  if (!PROPOSAL.test(proposal)) throw invalid("INVALID_PROPOSAL_ID", "a proposal id looks like ep- and twelve hexadecimal characters");
  return guarded(CODE, () => RUNTIME_COMMANDS.adopt.run({ ...runtimeOf(ctx, ids), door: "control" }, [proposal, "--human"]));
}

// This machine's block of the settings, replaced as a whole against the revision the page read.
export async function putRuntimeSettings(ctx, ids, body) {
  const given = body && typeof body === "object" ? body : {};
  if (!given.settings || typeof given.settings !== "object" || Array.isArray(given.settings)) throw invalid("RUNTIME_SETTINGS_INVALID", "send { settings, revision }");
  return { saved: await guarded("RUNTIME_SETTINGS_INVALID", () => keepRuntimeSettings(runtimeOf(ctx, ids), { next: given.settings, revision: given.revision ?? null })) };
}

const TARGET_ID = /^[a-z][a-z0-9-]{0,39}$/;

function targetOf(ids) {
  const [, , target] = ids;
  if (!TARGET_ID.test(target)) throw invalid("INVALID_TARGET_ID", "a reach target id is lowercase letters, digits and dashes, starting with a letter");
  return target;
}

// `provider` is the one field: which location to ask from. Absent, every location the target is checked from.
const fromOf = (given) => (given.provider ? [`--from=${given.provider}`] : []);

// The id's shape first, then the body -- so a body that names a host, a port or a command is refused
// before anything looks for a target at all -- and then the engine, which finds it in the settings.
function probing(name) {
  return (ctx, ids, body) => {
    const target = targetOf(ids);
    const given = fieldsOf(body, { provider: "provider" });
    return guarded(CODE, () => RUNTIME_COMMANDS[name].run(runtimeOf(ctx, ids), [target, ...fromOf(given)]));
  };
}

export const checkReach = probing("check");
export const retryReach = probing("retry");
