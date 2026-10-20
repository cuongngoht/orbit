// The sandboxes of ONE checkout, and a person's word about what may be run in them.
//
//   list      every sandbox the checkout's tasks own, read off the runtime's own table: nothing started,
//             nothing probed, nothing written
//   trust     one restore plan or one container definition, by its FINGERPRINT, from the Trust button a
//             person pressed -- the standing word that lets a sandbox run it. The grant is Control's alone:
//             the runtime refuses `trust` from any context that did not come through this door, and a
//             terminal cannot prove who typed. revoke takes it back
//
// A body is a choice among named fields -- a kind, a fingerprint, the settings revision the page read --
// and never an environment, a path or a command; a fingerprint is the shape one has, so a value that is
// not one is refused before the runtime is asked.
import { RUNTIME_COMMANDS } from "../core.mjs";
import { guarded, invalid } from "../errors.mjs";
import { fieldsOf } from "./body.mjs";
import { runtimeOf } from "./project.mjs";

const CODE = "RUNTIME_OPERATION_FAILED";

export const listSandboxes = (ctx, ids) => guarded("RUNTIME_UNAVAILABLE", () => RUNTIME_COMMANDS.sandboxes.run(runtimeOf(ctx, ids), []));

const FIELDS = { kind: "trustKind", fingerprint: "fingerprint", revision: "settingsRevision" };

function trustBody(body) {
  const given = fieldsOf(body, FIELDS);
  const absent = Object.keys(FIELDS).filter((k) => given[k] === undefined);
  if (absent.length) throw invalid("RUNTIME_BODY_INVALID", `send { kind, fingerprint, revision }: ${absent.join(", ")} is missing`);
  return given;
}

// The runtime's own words: --restore=<fp> or --definition=<fp>, against the revision read (none yet is
// no flag: the settings file was never written).
const argsOf = (given, revoke) => [`--${given.kind}=${given.fingerprint}`, ...(given.revision === null ? [] : [`--revision=${given.revision}`]), ...(revoke ? ["--revoke"] : [])];

const asControl = (ctx, ids) => ({ ...runtimeOf(ctx, ids), door: "control" });

const granting = (revoke) => (ctx, ids, body) => {
  const args = argsOf(trustBody(body), revoke);
  return guarded(CODE, () => RUNTIME_COMMANDS.trust.run(asControl(ctx, ids), args));
};

export const trustDefinition = granting(false);
export const revokeTrust = granting(true);
