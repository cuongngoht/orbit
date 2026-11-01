// THE HOST PROBE (`doctor --host`): whether a REAL coding host can run here at all, asked before a release spends hours
// on one. The runner image's Claude Code is started the way every round starts it -- the runner container on a network
// of its own whose only way out is the egress proxy to the model's API, the credential handed by name, the four egress
// checks before anything runs -- and asked one fixed question with no tool, no plugin and a budget of a few cents. What
// it answers is read back exactly as a round's stream is (`hostOf`): REPORTED, and used only to say whether the host ran,
// which version and model it says it is, and whether the credential was accepted. Nothing here falls back to another
// host, a scripted one or a mock: a host that does not answer is a code naming why, and a release reads it as BLOCKED.
//
//   probedHost(h, deps) -> { ok, code, says, image, reported, model, costUsd, egress, evidence }
//   HOST_CHECK -- ordered, first match wins, the last always matching      PROBE_PROMPT · PROBE_USD
import { mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { credentialNames, cpusetOf, engineOf, hostsOf, userOf } from "./context.mjs";
import { cleaned, dockerClientEnv } from "./docker.mjs";
import { imageDefs, resolvedImages } from "./images.mjs";
import { docWritten, newRunId, roomOf } from "./room.mjs";
import { fresh, roundRan, runnerSpecOf } from "./runner.mjs";
import { leaksMasked } from "./sentinel.mjs";

export const PROBE_PROMPT = "Reply with the single word READY and nothing else.";

export const PROBE_USD = 0.05;

// The probe's box: one CPU, a little memory, a short deadline -- it asks one question.
const PROBE_BOX = { cpus: 1, memoryMb: 2048, pids: 512, minutes: 3, outputMb: 1 };

const PROBE_MS = 3 * 60000;

// A credential the host can use: a name other than the endpoint's own, set here.
const credentialed = (ctx) => ctx.credentialNames.some((n) => n !== "ANTHROPIC_BASE_URL");

function imagesOrNull(h, deps) {
  try { return resolvedImages(imageDefs(engineOf(h)), deps, { need: ["runner", "verifier"] }); }
  catch { return null; }
}

// What a round's runner context holds, made for one question: no case, no subject, no task.
const probeCtx = (h, deps, images, room) => ({ run: { id: room.id }, room, deps, images, user: userOf(deps), allowedHosts: hostsOf(h.env), credentialNames: credentialNames(h.env, h.credential), caFile: h.caFile ? realpathSync(h.caFile) : null, storeBase: h.storeBase, repoRoot: h.root, dockerEnv: dockerClientEnv(h.env), case: { limits: { runner: PROBE_BOX } }, runnerCpuset: cpusetOf(deps, PROBE_BOX.cpus) });

// The brief a probe round reads, and an empty checkout for the runner's working directory (the place a plugin's types
// are kept is made in it, as in a subject, so the probe's container is a round's container to the attestation).
function probeDirs(ctx, model) {
  const d = { brief: fresh(ctx, "probe", "brief"), out: fresh(ctx, "probe", "out"), repo: fresh(ctx, "probe", "repo") };
  mkdirSync(join(d.repo, ".claude-plugin", "types"), { recursive: true });
  writeFileSync(join(d.brief, "brief.json"), `${JSON.stringify({ kind: "probe", round: 1, prompt: PROBE_PROMPT, usd: PROBE_USD, model: model ?? null, allowedHost: ctx.allowedHosts[0], outputBytes: PROBE_BOX.outputMb * 1024 * 1024 }, null, 2)}\n`);
  return d;
}

const probeSpec = (ctx, net, d) => runnerSpecOf(ctx, net, 1, [{ source: d.repo, target: "/work/repo", readOnly: true }, { source: d.out, target: "/work/out", readOnly: false }, { source: d.brief, target: "/run/brief", readOnly: true }]);

async function probeRan(ctx, model) {
  const d = probeDirs(ctx, model);
  const ran = await roundRan(ctx, 1, (net) => probeSpec(ctx, net, d), { deadlineMs: PROBE_MS, out: d.out });
  cleaned(ctx.run.id, ctx.deps);
  return ran;
}

// What a refused credential says, in the words a host prints for it -- read only to name the code, never to decide more.
const AUTH_WORDS = /invalid (x-)?api.?key|authenticat|unauthori[sz]ed|\b401\b|\b403\b|oauth|log ?in|credential|api key/i;

const hostSays = (f) => f.ran?.host?.errorText ?? "";

export const HOST_CHECK = [
  { code: "CLI_UNAVAILABLE", when: (f) => !f.images, says: () => "the runner image, or the verifier image its egress proxy runs in, is not built here: node benchmark/run.mjs build" },
  { code: "CLI_UNAVAILABLE", when: (f) => !f.images.claudeCode, says: () => "the runner image names no Claude Code version (label orbit.benchmark.claude-code): rebuild it, node benchmark/run.mjs build --runner --rebuild" },
  { code: "AUTH_MISSING", when: (f) => !f.credentialed, says: () => "no credential for the coding host is set here, by name (ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN; --credential=<NAME>)" },
  { code: "EGRESS", when: (f) => Boolean(f.ran.error), says: (f) => `the probe's network or its egress proxy could not be set up: ${f.ran.error.says}` },
  { code: "EGRESS", when: (f) => f.ran.start?.egress?.holds === false, says: () => "the runner's network does not hold to what a round needs: nothing direct, no outside name, only the model's API through the proxy" },
  { code: "CLI_UNAVAILABLE", when: (f) => Boolean(f.ran.runner?.error) || f.ran.runner?.exit === 127, says: (f) => `Claude Code did not start in the runner image (${f.ran.runner?.error ?? `exit ${f.ran.runner?.exit}`})` },
  { code: "AUTH_REFUSED", when: (f) => f.ran.host?.isError === true && AUTH_WORDS.test(hostSays(f)), says: (f) => `the model's API refused the credential: "${hostSays(f)}"` },
  { code: "PROVIDER", when: (f) => !f.ran.host?.started || f.ran.host?.isError !== false, says: (f) => `the host did not answer one question (${f.ran.host?.started ? hostSays(f) || "an error" : `exit ${f.ran.runner?.exit ?? f.ran.container?.exit ?? "?"} before its session started`})` },
  { code: "CLI_MISMATCH", when: (f) => f.ran.host.version !== f.images.claudeCode, says: (f) => `the host says it is Claude Code ${f.ran.host.version ?? "unknown"}, and the runner image pins ${f.images.claudeCode}` },
  { code: "OK", when: () => true, says: (f) => `Claude Code ${f.ran.host.version} answered as ${f.ran.host.model ?? "an unnamed model"} through the egress proxy` },
];

const verdictOf = (f) => ((row) => ({ ok: row.code === "OK", code: row.code, says: row.says(f), image: f.images?.claudeCode ?? null, reported: f.ran?.host?.version ?? null, model: f.ran?.host?.model ?? null, costUsd: f.ran?.host?.costUsd ?? null, egress: f.ran?.start?.egress ?? null, evidence: f.ran ? f.room.dir : null }))(HOST_CHECK.find((r) => r.when(f)));

// The probe's room keeps what it asked and what came back, and never the credential: the sentinel masks it wherever the
// host's output carried it, as it does for every run.
function kept(h, f) {
  docWritten(f.room, "manifest.json", { schema: 1, kind: "probe", run: f.room.id, at: new Date().toISOString(), images: f.images, verdict: verdictOf(f) });
  leaksMasked(f.room.dir, f.ctx.credentialNames.filter((n) => n !== "ANTHROPIC_BASE_URL").map((n) => h.env[n]));
  return verdictOf(f);
}

// Nothing is started for a probe that cannot be one: no image, no version pinned in it, or no credential to hand it.
export async function probedHost(h, deps, model = null) {
  const images = imagesOrNull(h, deps);
  const ctx = images?.claudeCode ? probeCtx(h, deps, images, roomOf(h.storeRoot, newRunId("probe"))) : null;
  const f = { images, ctx, room: ctx?.room ?? null, credentialed: Boolean(ctx) && credentialed(ctx) };
  return f.credentialed ? kept(h, { ...f, ran: await probeRan(ctx, model) }) : verdictOf(f);
}
