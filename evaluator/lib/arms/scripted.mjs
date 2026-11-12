// THE SCRIPTED ARM, for self-controls only: lib/container/scripted.mjs runs in place of a coding host, through the
// same entry, container, network and grader, so the evaluator can prove its own outcome words without a model. It
// applies a control patch of the task (gold, half, cheat, tamper, regress) or none, and says DONE, BLOCKED or nothing.
// Three controls act on the RUN rather than the agent, and only a scripted arm may carry them: a kill from outside
// after some seconds, an egress proxy that allows some other host, and a shorter wall time. Two act on the SEAT: `seat:
// "plugin"` hands it the plugin archive of `rev` and seats it with the plugin's own adoption command, as a seated model
// arm is; `seat: "writes-checkout"` seats it with a command that writes a file into the checkout, which must end the run
// INFRA_ERROR (SEAT) before any agent runs.
import { join } from "node:path";
import { EVALUATOR_DIR } from "../core/util.mjs";
import { TOOLS_MOUNT } from "../core/versions.mjs";
import { preparedPlugin, resolvedPlugin, SEAT_ARGV } from "./plugin.mjs";

const BEHAVIOURS = ["patch", "noop", "sleep"];
const STATUSES = ["DONE", "BLOCKED", "NONE"];
const FIELDS = ["kind", "behaviour", "patch", "status", "killAfterSeconds", "egressAllow", "minutes", "seat", "rev"];

// A seat command that writes the checkout: what a seat must never do.
export const WRITING_SEAT = [`${TOOLS_MOUNT}/bin/node`, "-e", "require('node:fs').writeFileSync('seat-wrote-this.txt', 'a seat must never write the checkout\\n')"];

const SEATS = { plugin: { argv: SEAT_ARGV }, "writes-checkout": { argv: WRITING_SEAT } };

const withPlugin = (def) => def.seat === "plugin";

const problemsOf = (def) => [
  ...(BEHAVIOURS.includes(def.behaviour) ? [] : [`behaviour must be one of ${BEHAVIOURS.join(", ")}`]),
  ...(STATUSES.includes(def.status ?? "DONE") ? [] : [`status must be one of ${STATUSES.join(", ")}`]),
  ...(def.behaviour === "patch" && !/^[a-z]+$/.test(def.patch ?? "") ? ["a patch behaviour names the task's control patch (gold, half, cheat, tamper, regress)"] : []),
  ...(def.seat === undefined || SEATS[def.seat] ? [] : [`seat must be one of ${Object.keys(SEATS).join(", ")}`]),
  ...(withPlugin(def) === (typeof def.rev === "string" && def.rev.length > 0) ? [] : ["rev (the plugin to seat) goes with seat: \"plugin\", and only with it"]),
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
    seat: SEATS[def.seat] ?? null,
    validate: () => problemsOf(def),
    freeze: (ctx) => (withPlugin(def) ? resolvedPlugin(ctx.pluginRepo, def.rev) : {}),
    files: (ctx) => [{ kind: "agent", from: join(EVALUATOR_DIR, "lib", "container", "scripted.mjs"), name: "scripted.mjs" }, ...(def.behaviour === "patch" ? [{ kind: "agent", bytes: ctx.task.controlPatch(def.patch), name: "control.patch" }] : []), ...(withPlugin(def) ? ((p) => [{ kind: "plugin", from: p.dir, to: "/opt", digest: p.digest, files: p.files }])(preparedPlugin(ctx.home, ctx.pluginRepo, ctx.frozen.commit)) : [])],
    argv: () => [`${TOOLS_MOUNT}/bin/node`, "/opt/evalrun/agent/scripted.mjs", def.behaviour, def.status ?? "DONE", "/opt/evalrun/agent/control.patch"],
  };
}
