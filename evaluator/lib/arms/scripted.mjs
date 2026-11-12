// THE SCRIPTED ARM, for self-controls only: lib/container/scripted.mjs runs in place of a coding host, through the
// same entry, container, network and grader, so the evaluator can prove its own outcome words without a model. It
// applies a control patch of the task (gold, half, cheat, tamper, regress) or none, and says DONE, BLOCKED or nothing.
// Three controls act on the RUN rather than the agent, and only a scripted arm may carry them: a kill from outside
// after some seconds, an egress proxy that allows some other host, and a shorter wall time.
import { join } from "node:path";
import { EVALUATOR_DIR } from "../core/util.mjs";
import { TOOLS_MOUNT } from "../core/versions.mjs";

const BEHAVIOURS = ["patch", "noop", "sleep"];
const STATUSES = ["DONE", "BLOCKED", "NONE"];
const FIELDS = ["kind", "behaviour", "patch", "status", "killAfterSeconds", "egressAllow", "minutes"];

const problemsOf = (def) => [
  ...(BEHAVIOURS.includes(def.behaviour) ? [] : [`behaviour must be one of ${BEHAVIOURS.join(", ")}`]),
  ...(STATUSES.includes(def.status ?? "DONE") ? [] : [`status must be one of ${STATUSES.join(", ")}`]),
  ...(def.behaviour === "patch" && !/^[a-z]+$/.test(def.patch ?? "") ? ["a patch behaviour names the task's control patch (gold, half, cheat, tamper, regress)"] : []),
  ...Object.keys(def).filter((k) => !FIELDS.includes(k)).map((k) => `${k} is not a field of a scripted arm`),
];

export function scriptedArm(id, def) {
  return {
    id,
    kind: "scripted",
    def,
    charges: false,
    needsNetwork: true,
    credentialNames: [],
    control: { killAfterSeconds: def.killAfterSeconds ?? null, egressAllow: def.egressAllow ?? null, minutes: def.minutes ?? null },
    validate: () => problemsOf(def),
    freeze: () => ({}),
    files: (ctx) => [{ kind: "agent", from: join(EVALUATOR_DIR, "lib", "container", "scripted.mjs"), name: "scripted.mjs" }, ...(def.behaviour === "patch" ? [{ kind: "agent", bytes: ctx.task.controlPatch(def.patch), name: "control.patch" }] : [])],
    argv: () => [`${TOOLS_MOUNT}/bin/node`, "/opt/evalrun/agent/scripted.mjs", def.behaviour, def.status ?? "DONE", "/opt/evalrun/agent/control.patch"],
  };
}
