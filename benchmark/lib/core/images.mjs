// THE IMAGES a benchmark runs in, built once from their own directories and reused by id: the tag names the digest of
// the definition (so a changed Dockerfile is a new tag, never an old image under a new meaning), and a run pins the
// image ID it resolved. No image holds a source: one image serves every source a run freezes.
//
//   imageDefs(root) -> { verifier, runner, qa-worker } each { role, dir, tag, network }
//   builtImage(def, deps, rebuild) -> { role, tag, id, reused }
//   resolvedImages(defs, deps, { need, prefer }) -> { verifier, runner, qaWorker, claudeCode, tags }
import { join } from "node:path";
import { Blocked } from "../../../src/errors.mjs";
import { BUILD_MS, buildArgv, docker } from "../../../src/runtime/isolation/docker.mjs";
import { scrub } from "../../../src/scrub.mjs";
import { dockerClientEnv } from "./docker.mjs";
import { dirDigest } from "./suites.mjs";

// verifier: the source cases' probes and gates, and the egress proxy · runner: the coding host · qa-worker: the
// browser a QA case's generated page tests drive, in the isolated sandbox Orbit's own engine runs them in.
export const ROLES = ["verifier", "runner", "qa-worker"];

// The runner and the QA worker install from the npm registry, so they are built with a network; the verifier, none.
const BUILD_NETWORK = { verifier: "none", runner: "default", "qa-worker": "default" };

// The name a role's image goes by in a run's manifest.
const KEY = { verifier: "verifier", runner: "runner", "qa-worker": "qaWorker" };

export const imageDefs = (root) => Object.fromEntries(ROLES.map((role) => ((dir) => [role, { role, dir, tag: `orbit-benchmark-${role}:${dirDigest(dir).slice(0, 12)}`, network: BUILD_NETWORK[role] }])(join(root, "benchmark", "images", role))));

// The image's own ID, whichever image store the daemon keeps (with the containerd store, a local build carries a
// repository digest too): the one name a container is created from and inspected back as.
const idOf = (ref, deps) => ((r) => ((id) => (/^sha256:[0-9a-f]{64}$/.test(id) ? id : null))(r.ok ? String(r.out).trim() : ""))(deps.process.run("docker", ["image", "inspect", "--format", "{{.Id}}", ref], { timeoutMs: 30000, env: dockerClientEnv(deps.env) }));

// The provider's own build argument list, with a person's CA handed as a build secret when they named one: the context
// is always the image's own directory, so nothing else of the repository reaches a build.
export const buildArgvOf = (def, ca) => ((argv) => [...argv.slice(0, -1), ...(ca ? ["--secret", `id=orbit-ca,src=${ca}`] : []), argv.at(-1)])(buildArgv({ dockerfile: join(def.dir, "Dockerfile"), tag: def.tag, labels: { "orbit.benchmark.image": def.role }, context: def.dir, network: def.network }));

// What a failed build said that a person can act on: its error lines, scrubbed, never the whole log.
const buildError = (r) => scrub(String(r.err ?? r.out ?? r.error ?? "").split("\n").filter((l) => /error|ERROR|failed|denied|certificate/.test(l)).slice(-6).join(" | ")).slice(0, 700) || String(r.error ?? "docker build failed");

export function builtImage(def, deps, rebuild, ca = null) {
  const had = rebuild ? null : idOf(def.tag, deps);
  if (had) return { role: def.role, tag: def.tag, id: had, reused: true };
  const r = deps.process.run("docker", buildArgvOf(def, ca), { timeoutMs: BUILD_MS, env: dockerClientEnv(deps.env), maxBuffer: 64 * 1024 * 1024 });
  if (!r.ok) throw new Blocked(`the ${def.role} image could not be built from ${def.dir}: ${buildError(r)}`);
  return { role: def.role, tag: def.tag, id: idOf(def.tag, deps), reused: false };
}

const labelOf = (id, deps, key) => docker.container.inspect(id, deps)?.Config?.Labels?.[key] ?? null;

// The images a run pins: the ids an earlier run used, when it asks for them and they are still here; otherwise the ones
// the current definitions are tagged with. A role a run needs and nothing provides is BLOCKED, naming the command.
export function resolvedImages(defs, deps, o = {}) {
  const pick = (role) => (o.prefer?.[KEY[role]] && idOf(o.prefer[KEY[role]], deps)) || idOf(defs[role].tag, deps);
  const ids = Object.fromEntries(ROLES.map((role) => [KEY[role], o.need.includes(role) ? pick(role) : null]));
  const missing = o.need.filter((role) => !ids[KEY[role]]);
  if (missing.length) throw new Blocked(`no ${missing.join(" or ")} image is built for these definitions — node benchmark/run.mjs build${missing.includes("qa-worker") ? " --qa-worker" : ""}`);
  return { ...ids, claudeCode: ids.runner ? labelOf(ids.runner, deps, "orbit.benchmark.claude-code") : null, tags: Object.fromEntries(ROLES.map((r) => [r, defs[r].tag])) };
}

export const imageIdOf = idOf;
