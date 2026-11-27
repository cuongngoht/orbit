#!/usr/bin/env node
// Builds an Orbit Web image from the repository root (the plugin is `git archive` of ORBIT_REF, default HEAD).
//
//   node scripts/build-image.mjs [--tag=orbit-web:0.8.1-beta1] [--target=workstation|model-plane|storage-helper] [--ref=<commit|tag>] [--ca-file=<pem>] [--platform=linux/amd64]
//
// Without --target it builds Orbit Web itself (the Dockerfile's last stage); --target builds one of the three images an
// AI employee's attempt is started from, out of the same Dockerfile (tagged orbit-web-<target>:<version> by default).
// --ca-file hands a TLS-inspecting proxy's CA to the download steps as a BuildKit secret; it is never kept in a layer.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const WEB = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPO = join(WEB, "..", "..");
const version = JSON.parse(readFileSync(join(WEB, "package.json"), "utf8")).version;
const opt = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? null;

const TARGETS = ["workstation", "model-plane", "storage-helper"];
const target = opt("target");
if (target !== null && !TARGETS.includes(target)) {
  process.stderr.write(`build-image: --target must be one of ${TARGETS.join(", ")} (or left out, for Orbit Web itself), not ${JSON.stringify(target)}\n`);
  process.exit(2);
}

const tag = opt("tag") ?? (target === null ? `orbit-web:${version}` : `orbit-web-${target}:${version}`);
const args = ["build", "-f", "integrations/orbit-web/docker/Dockerfile", "-t", tag, "--build-arg", `WEB_VERSION=${version}`];
if (target !== null) args.push("--target", target);
if (opt("ref")) args.push("--build-arg", `ORBIT_REF=${opt("ref")}`);
if (opt("ca-file")) args.push("--secret", `id=ca,src=${opt("ca-file")}`);
if (opt("platform")) args.push("--platform", opt("platform"));
args.push(".");

process.stdout.write(`docker ${args.join(" ")}\n`);
const r = spawnSync("docker", args, { cwd: REPO, stdio: "inherit", env: { ...process.env, DOCKER_BUILDKIT: "1" } });
process.exit(r.status ?? 1);
