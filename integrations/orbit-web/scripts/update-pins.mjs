#!/usr/bin/env node
// THE PINS OF ORBIT WEB'S IMAGE, MOVED TO WHAT THEIR PUBLISHERS RELEASED -- without waiting for a new Orbit Web.
//
//   node scripts/update-pins.mjs            what would move, and what a person moves by hand (nothing is written)
//   node scripts/update-pins.mjs --apply    write the moved pins into docker/Dockerfile
//
// Moved here: Claude Code and OpenAI Codex (npm's newest -- npm checks each package's integrity as it installs it), and
// GitHub CLI (its newest release, with BOTH Linux archives' SHA-256 read from that release's own checksums file, or not
// at all). Said, not moved: the Azure CLI (a hashed lock to pin again), Antigravity (its manifest's build and SHA-512),
// Node.js and the base system (an image digest), Python (a standalone build and its SHA-256). Then build the images again
// and restart (README, Settings → System). Nothing of this installation is sent: plain GETs of public feeds.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ARG = /^ARG ([A-Z0-9_]+)=(.*)$/;

// The Dockerfile's pins, as written: every `ARG NAME=value` line.
export function readPins(dockerfile) {
  const pins = new Map();
  for (const line of dockerfile.split("\n")) {
    const m = ARG.exec(line);
    if (m !== null) pins.set(m[1], m[2]);
  }
  return pins;
}

// The Dockerfile with the named pins moved, and every other line as it was.
export function withPins(dockerfile, changes) {
  return dockerfile
    .split("\n")
    .map((line) => {
      const m = ARG.exec(line);
      return m !== null && m[1] in changes ? `ARG ${m[1]}=${changes[m[1]]}` : line;
    })
    .join("\n");
}

// The SHA-256 a release's checksums file gives one archive, or null.
export function checksumOf(sums, file) {
  for (const line of sums.split("\n")) {
    const [sha, name] = line.trim().split(/\s+/);
    if (name === file && /^[0-9a-f]{64}$/.test(sha ?? "")) return sha;
  }
  return null;
}

const tag = (v) => (typeof v === "string" ? v.replace(/^v/, "") : null);
const message = (err) => (err instanceof Error ? err.message : String(err));

async function npmNewest(fetchText, pkg) {
  return tag(JSON.parse(await fetchText(`https://registry.npmjs.org/${pkg}/latest`)).version);
}

// GitHub CLI's newest release, with its two Linux archives' checksums -- all of them, or none.
async function ghNewest(fetchText) {
  const v = tag(JSON.parse(await fetchText("https://api.github.com/repos/cli/cli/releases/latest")).tag_name);
  if (v === null) throw new Error("its release named no version");
  const sums = await fetchText(`https://github.com/cli/cli/releases/download/v${v}/gh_${v}_checksums.txt`);
  const amd64 = checksumOf(sums, `gh_${v}_linux_amd64.tar.gz`);
  const arm64 = checksumOf(sums, `gh_${v}_linux_arm64.tar.gz`);
  const missing = [amd64 === null ? `gh_${v}_linux_amd64.tar.gz` : null, arm64 === null ? `gh_${v}_linux_arm64.tar.gz` : null].filter((x) => x !== null);
  if (missing.length > 0) throw Object.assign(new Error(`its checksums file names no ${missing.join(" and no ")}`), { version: v });
  return { GH_VERSION: v, GH_SHA256_AMD64: amd64, GH_SHA256_ARM64: arm64 };
}

const BY_HAND = [
  "Azure CLI (AZURE_CLI_VERSION): pin its hashed lock again with the Orbit repository's skills/orbit-release/pin-python-lock.mjs, then move AZURE_CLI_VERSION.",
  "Antigravity CLI (AGY_VERSION, AGY_BUILD, AGY_SHA512_*): from the manifest its install script reads (https://antigravity.google/cli/install.sh).",
  "Node.js and the base system (NODE_IMAGE, UBUNTU_IMAGE): `docker pull` the tag, then pin the digest it names.",
  "Python (PYTHON_*, AGENT_PYTHON_*): a python-build-standalone release and its SHA-256 for each architecture.",
];

// What moves (only to a newer release a publisher named), and what is said: what a person moves by hand, and every
// publisher that could not be asked.
export async function planPins(pins, fetchText) {
  const changes = {};
  const notes = [];
  const npm = [
    ["Claude Code", "CLAUDE_CODE_VERSION", "@anthropic-ai/claude-code"],
    ["OpenAI Codex", "CODEX_VERSION", "@openai/codex"],
  ];
  for (const [label, name, pkg] of npm) {
    try {
      const v = await npmNewest(fetchText, pkg);
      if (v !== null && v !== pins.get(name)) changes[name] = v;
    } catch (err) {
      notes.push(`${label} not moved: npm could not be asked (${message(err)}).`);
    }
  }
  try {
    const gh = await ghNewest(fetchText);
    if (gh.GH_VERSION !== pins.get("GH_VERSION")) Object.assign(changes, gh);
  } catch (err) {
    notes.push(`GitHub CLI${err?.version ? ` ${err.version}` : ""} not moved: ${message(err)}.`);
  }
  return { changes, notes: [...notes, ...BY_HAND] };
}

const fetchText = async (url) => {
  const res = await fetch(url, { headers: { "user-agent": "orbit-web-update-pins" }, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
};

async function main() {
  const file = join(dirname(fileURLToPath(import.meta.url)), "..", "docker", "Dockerfile");
  const dockerfile = readFileSync(file, "utf8");
  const pins = readPins(dockerfile);
  const { changes, notes } = await planPins(pins, fetchText);
  const moved = Object.entries(changes);
  process.stdout.write(moved.length === 0 ? "Every pin moved here is at its publisher's newest release.\n" : moved.map(([k, v]) => `${k}: ${pins.get(k)} -> ${v}\n`).join(""));
  for (const n of notes) process.stdout.write(`- ${n}\n`);
  if (!process.argv.includes("--apply")) {
    if (moved.length > 0) process.stdout.write("\nNothing was written: run again with --apply to move them in docker/Dockerfile.\n");
    return;
  }
  if (moved.length > 0) writeFileSync(file, withPins(dockerfile, changes));
  process.stdout.write(`\n${moved.length} pin(s) written. Build the images again and restart: node scripts/build-image.mjs (and the workstation, model-plane and storage-helper targets), then docker compose up -d.\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();
