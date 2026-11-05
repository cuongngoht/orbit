// THE CONTAINERS of an activation run (0.5.0, B22 M4) beside its seed (seed.mjs): the HOST's round -- the prompt, exactly as a person would
// type it, handed to Claude Code (or to a control's scripted host) with the plugin its arm hands, a WRITABLE checkout of
// the target, and the case's switches by name and value -- and the INSPECTION, which reads back what the round left with
// the run's own Orbit whichever plugin the host was handed (`inspectorDir`). Nothing here judges: the judge does.
//
//   hostRan(ctx, o) -> round          inspected(ctx) -> { end, …documents }          requestOf(ctx) -> the prompt
//   scriptOf(ctx) -> a control's script | null          scriptedHost(ctx)          briefWritten(ctx, parts, brief) -> dir
//   PLUGIN_AT · REPO_AT · INSPECTED          (the seed round is seed.mjs)
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { docker } from "../../../src/runtime/isolation/docker.mjs";
import { ranContainer, specFor } from "../core/docker.mjs";
import { forbidden, fresh, jsonAt, offlineRan, roundRan, RUNNER_HOST, runnerSpecOf, streamFileOf } from "../core/runner.mjs";

// Where Orbit is in every container of the run, and where the target is.
export const PLUGIN_AT = "/work/orbit";

export const REPO_AT = "/work/repo";

const handed = (ctx) => ctx.arm !== "none";

// The prompt, verbatim, in its language: what a person types, and all the host is told.
export const requestOf = (ctx) => readFileSync(join(ctx.frozenCase, ctx.case.request), "utf8");

export const scriptedHost = (ctx) => /^(scripted|session):/.test(String(ctx.host ?? ""));

// ---- the control a scripted host plays: its row, and its file's steps and edits (or the defaults of its kind) ------------

const controlRow = (ctx) => (ctx.case.controls ?? []).find((k) => `scripted:${k.id}` === ctx.host) ?? null;

const controlDoc = (ctx, k) => (k.file ? JSON.parse(readFileSync(join(ctx.frozenCase, k.file), "utf8")) : {});

const scriptFrom = (k, d) => ({ id: k.id, mode: "activation", kind: k.host, steps: d.steps, edits: d.edits ?? null, session: `scripted-${k.id}` });

export const scriptOf = (ctx) => ((k) => (k ? scriptFrom(k, controlDoc(ctx, k)) : null))(controlRow(ctx));

export const briefWritten = (ctx, parts, brief) => ((dir) => (writeFileSync(join(dir, "brief.json"), `${JSON.stringify(brief, null, 2)}\n`), dir))(fresh(ctx, ...parts));

// ---- the host's round ----------------------------------------------------------------------------------------------------

const briefOf = (ctx) => ({ kind: "activation", round: 1, host: ctx.host ?? null, arm: ctx.arm, plugin: handed(ctx) ? PLUGIN_AT : null, script: scriptOf(ctx), prompt: requestOf(ctx), model: ctx.model ?? null, effort: ctx.effort ?? null, usd: ctx.limits.usd, maxTurns: ctx.case.limits.maxTurns, allowedHost: ctx.allowedHosts[0], outputBytes: ctx.case.limits.runner.outputMb * 1024 * 1024 });

const hostMounts = (ctx, d) => [{ source: ctx.worktreeDir, target: REPO_AT, readOnly: false }, ...(handed(ctx) ? [{ source: ctx.pluginDir, target: PLUGIN_AT, readOnly: true }] : []), { source: ctx.runnerStore, target: "/work/store", readOnly: false }, { source: d.out, target: "/work/out", readOnly: false }, { source: d.brief, target: "/run/brief", readOnly: true }];

const hostSpec = (ctx, net, d) => runnerSpecOf(ctx, net, 1, hostMounts(ctx, d), ctx.switches ?? {}, handed(ctx) ? PLUGIN_AT : null);

// o: { deadlineMs, held }. A scripted host's round has no network at all; a coding host's reaches the model's API alone.
export async function hostRan(ctx, o) {
  const d = { brief: briefWritten(ctx, ["rounds", "1", "brief"], briefOf(ctx)), out: fresh(ctx, "rounds", "1", "out") };
  const run = { deadlineMs: o.deadlineMs, out: d.out, held: o.held, heldEveryMs: ctx.heldEveryMs, capture: streamFileOf(ctx, 1) };
  return scriptedHost(ctx) ? offlineRan(ctx, 1, hostSpec(ctx, null, d), run) : roundRan(ctx, 1, (net) => hostSpec(ctx, net, d), run);
}

// ---- the inspection --------------------------------------------------------------------------------------------------------

const inspectMounts = (ctx, out) => [{ source: ctx.checkoutDir, target: REPO_AT, readOnly: true }, { source: ctx.inspectorDir, target: PLUGIN_AT, readOnly: true }, { source: ctx.worktreeDir, target: "/work/worktree", readOnly: true }, { source: ctx.runnerStore, target: "/work/store", readOnly: true }, { source: out, target: "/work/out", readOnly: false }];

const inspectSpec = (ctx, out) => specFor("inspect", ctx.run, { n: 1, image: ctx.images.runner, user: ctx.user, hostname: RUNNER_HOST, argv: ["node", "/bench/inspect.mjs", "-", `--plugin=${PLUGIN_AT}`, "--tree=/work/worktree", "--activation"], mounts: inspectMounts(ctx, out), env: { names: [], values: { HOME: "/tmp", ORBIT_STORE_DIR: "/work/store" } }, limits: { cpus: 1, memoryMb: 1024, pids: 256 }, tmpMb: 256 });

// The documents an activation inspection writes (images/runner/inspect.mjs --activation).
export const INSPECTED = ["inspect", "workspace", "task", "tasks", "trace", "turns", "goals", "activation", "views", "workflows", "works", "rooms", "uitests", "ledger", "plans", "plancheck", "check"];

const endOf = (r) => (r.refused ? "REFUSED" : r.timedOut ? "TIMEOUT" : `EXIT_${r.exit}`);

export async function inspected(ctx) {
  const out = fresh(ctx, "rounds", "1", "inspect");
  const r = await ranContainer(inspectSpec(ctx, out), ctx.deps, { input: "", timeoutMs: 600000, outputBytes: 1024 * 1024, attest: { network: "none", forbidden: forbidden(ctx), pluginTarget: null, imageEnv: docker.imageEnv(ctx.images.runner, ctx.deps) } });
  return { end: endOf(r), refused: r.refused ?? null, dir: out, ...Object.fromEntries(INSPECTED.map((n) => [n, jsonAt(join(out, `${n}.json`))])) };
}
