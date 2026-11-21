#!/usr/bin/env node
// What the release workflow asks before and after it publishes, runnable anywhere:
//
//   node scripts/release.mjs verify --version=0.8.0
//     the version asked is integrations/orbit-web/package.json's (and every workspace's), and CHANGELOG.md has a
//     "## Orbit Web <version>" section; exits 1 naming what does not hold.
//   node scripts/release.mjs notes --version=0.8.0 --image=ghcr.io/<owner>/orbit-web --digest=sha256:… --commit=<sha> [--latest=true]
//     the release notes: that changelog section, the image by digest, and the plugin it bundles.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const WEB = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPO = join(WEB, "..", "..");
const opt = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? null;
const json = (path) => JSON.parse(readFileSync(path, "utf8"));

const MANIFESTS = ["package.json", "packages/contracts/package.json", "packages/governance-core/package.json", "apps/api/package.json", "apps/web/package.json"];

export function changelogSection(text, version) {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => l.trim() === `## Orbit Web ${version}`);
  if (start === -1) return null;
  const end = lines.findIndex((l, i) => i > start && /^## /.test(l));
  return lines.slice(start + 1, end === -1 ? undefined : end).join("\n").trim();
}

function verify(version) {
  const problems = [];
  if (!/^\d+\.\d+\.\d+$/.test(version ?? "")) problems.push(`--version must be a release version (x.y.z), not ${JSON.stringify(version)}`);
  for (const m of MANIFESTS) {
    const v = json(join(WEB, m)).version;
    if (v !== version) problems.push(`${m} says ${v}, not ${version}`);
  }
  const contract = /ORBIT_WEB_VERSION = "([^"]+)"/.exec(readFileSync(join(WEB, "packages/contracts/src/index.ts"), "utf8"))?.[1];
  if (contract !== version) problems.push(`packages/contracts says ORBIT_WEB_VERSION ${contract}, not ${version}`);
  if (changelogSection(readFileSync(join(REPO, "CHANGELOG.md"), "utf8"), version) === null) problems.push(`CHANGELOG.md has no "## Orbit Web ${version}" section`);
  for (const p of problems) process.stderr.write(`release: ${p}\n`);
  if (problems.length > 0) process.exit(1);
  process.stdout.write(`release: Orbit Web ${version} is the version in the tree, and the changelog has it\n`);
}

function notes(o) {
  const section = changelogSection(readFileSync(join(REPO, "CHANGELOG.md"), "utf8"), o.version) ?? "";
  const plugin = json(join(REPO, ".claude-plugin", "plugin.json")).version;
  const out = [
    section,
    "",
    "## Image",
    "",
    `- \`${o.image}:${o.version}\`${o.latest === "true" ? ` (also \`${o.image}:latest\`)` : ""}`,
    `- Immutable reference: \`${o.image}@${o.digest}\``,
    `- Built from commit \`${o.commit}\`, which is also the Orbit plugin it bundles (Orbit ${plugin}, \`git archive\` of that commit).`,
    "",
    "```bash",
    `docker run -d --name orbit-web --hostname orbit-web -p 127.0.0.1:3000:3000 -v orbit-web-data:/data ${o.image}@${o.digest}`,
    "```",
    "",
  ];
  process.stdout.write(`${out.join("\n")}\n`);
}

const command = process.argv[2];
if (command === "verify") verify(opt("version"));
else if (command === "notes") notes({ version: opt("version"), image: opt("image"), digest: opt("digest"), commit: opt("commit"), latest: opt("latest") });
else {
  process.stderr.write("usage: release.mjs verify --version=<v> | notes --version=<v> --image=<ref> --digest=<sha256:…> --commit=<sha> [--latest=true]\n");
  process.exit(2);
}
