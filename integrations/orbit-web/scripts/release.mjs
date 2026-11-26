#!/usr/bin/env node
// What the release workflow asks before and after it publishes, runnable anywhere:
//
//   node scripts/release.mjs verify --version=0.8.1
//     the version asked is integrations/orbit-web/package.json's (and every workspace's, each workspace's pins of the
//     others, and the lock file's), the image's WEB_VERSION, CHANGELOG.md has a "## Orbit Web <version>" section, and
//     every published image the compose files, the README and the code's own defaults name is tagged with that version
//     (a compose file that still names a release candidate would pull it); exits 1 naming what does not hold.
//   node scripts/release.mjs notes --version=0.8.1 --registry=ghcr.io/<owner> --repository=<owner>/<repo> --commit=<sha>
//       --digests=orbit-web=sha256:…,orbit-web-workstation=sha256:…,orbit-web-model-plane=sha256:…,orbit-web-storage-helper=sha256:…
//       [--latest=true]
//     the release notes: that changelog section, the four images by digest, how to run them, and the plugin it bundles.
import { readFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const WEB = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPO = join(WEB, "..", "..");
const opt = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? null;
const json = (path) => JSON.parse(readFileSync(path, "utf8"));

const MANIFESTS = ["package.json", "packages/contracts/package.json", "packages/governance-core/package.json", "apps/api/package.json", "apps/web/package.json"];

// The four images a release publishes, under one tag: Orbit Web itself (the Dockerfile's last stage) and the three an
// AI employee's attempt is started from (its workstation, model-plane and storage-helper targets).
export const IMAGES = ["orbit-web", "orbit-web-workstation", "orbit-web-model-plane", "orbit-web-storage-helper"];

// The files that tell a person which images to run, by tag -- and the ones that run them by default: the allocator's
// configuration and the real-container test tier.
const RUN_FILES = ["docker/compose.yaml", "docker/compose.published.yaml", "docker/compose.governed.yaml", "README.md", "apps/api/src/config/sandbox-config.ts", "apps/api/tests/sandbox/harness.ts"];

// Every `@orbit-web/*` dependency a manifest (or a lock entry) pins at another version than the release's.
export function internalPins(manifest, version) {
  const deps = { ...(manifest.dependencies ?? {}), ...(manifest.devDependencies ?? {}) };
  return Object.entries(deps)
    .filter(([name, spec]) => name.startsWith("@orbit-web/") && spec !== version)
    .map(([name, spec]) => `${name} ${spec}`);
}

// What the lock file says that is not the release: its own version, the root's and each workspace's (an entry outside
// node_modules), and each workspace's pins of the others. A third-party package is never asked.
export function lockProblems(lock, version) {
  const problems = lock.version === version ? [] : [`package-lock.json says ${lock.version}`];
  for (const [path, entry] of Object.entries(lock.packages ?? {})) {
    if (path.includes("node_modules")) continue;
    const name = path === "" ? "(root)" : path;
    if (entry.version !== version) problems.push(`package-lock.json ${name} says ${entry.version}`);
    for (const pin of internalPins(entry, version)) problems.push(`package-lock.json ${name} pins ${pin}`);
  }
  return problems;
}

// The version the tool bridge tells the AI CLI it serves (its MCP serverInfo): the bridge runs alone in the model plane
// and imports nothing of Orbit Web's, so it says the version itself -- held here to the release's.
export function bridgeVersion(text) {
  return /serverInfo: \{ name: "orbit_tools", version: "([^"]+)" \}/.exec(text)?.[1] ?? null;
}

// The version Orbit Web's image says it is (the Dockerfile's WEB_VERSION argument), or null.
export function webVersionArg(text) {
  return /^ARG WEB_VERSION=(\S+)$/m.exec(text)?.[1] ?? null;
}

export function changelogSection(text, version) {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => l.trim() === `## Orbit Web ${version}`);
  if (start === -1) return null;
  const end = lines.findIndex((l, i) => i > start && /^## /.test(l));
  return lines.slice(start + 1, end === -1 ? undefined : end).join("\n").trim();
}

// Every tag a text gives the published images that is not the version: `ghcr.io/<owner>/orbit-web…:<tag>` and the
// ORBIT_WEB_TAG default. Only a tag that starts with a digit is a version (`latest` and a `<version>` placeholder are not).
export function otherTags(text, version) {
  const named = [...text.matchAll(/ghcr\.io\/[^/\s]+\/orbit-web[a-z-]*\*?:(\d[^\s"'`}$)*]*)/g), ...text.matchAll(/ORBIT_WEB_TAG(?::-|=)(\d[^}\s"'`]*)/g)];
  return [...new Set(named.map((m) => m[1]).filter((tag) => tag !== version))];
}

function verify(version) {
  const problems = [];
  if (!/^\d+\.\d+\.\d+$/.test(version ?? "")) problems.push(`--version must be a release version (x.y.z), not ${JSON.stringify(version)}`);
  for (const m of MANIFESTS) {
    const manifest = json(join(WEB, m));
    if (manifest.version !== version) problems.push(`${m} says ${manifest.version}, not ${version}`);
    for (const pin of internalPins(manifest, version)) problems.push(`${m} pins ${pin}, not ${version}`);
  }
  for (const p of lockProblems(json(join(WEB, "package-lock.json")), version)) problems.push(`${p}, not ${version}`);
  const arg = webVersionArg(readFileSync(join(WEB, "docker/Dockerfile"), "utf8"));
  if (arg !== version) problems.push(`docker/Dockerfile says ARG WEB_VERSION=${arg}, not ${version}`);
  const bridge = bridgeVersion(readFileSync(join(WEB, "apps/api/src/bridge/main.ts"), "utf8"));
  if (bridge !== version) problems.push(`apps/api/src/bridge/main.ts says it is ${bridge}, not ${version}`);
  const contract = /ORBIT_WEB_VERSION = "([^"]+)"/.exec(readFileSync(join(WEB, "packages/contracts/src/index.ts"), "utf8"))?.[1];
  if (contract !== version) problems.push(`packages/contracts says ORBIT_WEB_VERSION ${contract}, not ${version}`);
  if (changelogSection(readFileSync(join(REPO, "CHANGELOG.md"), "utf8"), version) === null) problems.push(`CHANGELOG.md has no "## Orbit Web ${version}" section`);
  for (const file of RUN_FILES) {
    const tags = otherTags(readFileSync(join(WEB, file), "utf8"), version);
    if (tags.length > 0) problems.push(`${file} names the images ${tags.join(", ")}, not ${version}`);
  }
  for (const p of problems) process.stderr.write(`release: ${p}\n`);
  if (problems.length > 0) process.exit(1);
  process.stdout.write(`release: Orbit Web ${version} is the version in the tree and of every image it names, and the changelog has it\n`);
}

// `orbit-web=sha256:…,orbit-web-workstation=sha256:…` -> { name: digest }, or the images whose digest is missing.
export function digestsOf(list) {
  const given = Object.fromEntries((list ?? "").split(",").filter(Boolean).map((pair) => [pair.slice(0, pair.indexOf("=")), pair.slice(pair.indexOf("=") + 1)]));
  const missing = IMAGES.filter((name) => !/^sha256:[0-9a-f]{64}$/.test(given[name] ?? ""));
  return missing.length > 0 ? { missing } : { digests: given };
}

export function releaseNotes({ section, version, registry, repository, commit, digests, latest, plugin }) {
  const compose = `https://raw.githubusercontent.com/${repository}/${commit}/integrations/orbit-web/docker/compose.published.yaml`;
  return [
    section,
    "",
    "## Images",
    "",
    "Four images under one tag: Orbit Web itself, and the three its allocator starts an AI employee's attempt from.",
    "",
    ...IMAGES.map((name) => `- \`${registry}/${name}:${version}\`${latest ? " (also `latest`)" : ""}: \`${registry}/${name}@${digests[name]}\``),
    "",
    `Built from commit \`${commit}\`, which is also the Orbit plugin Orbit Web bundles (Orbit ${plugin}, \`git archive\` of that commit).`,
    "",
    "## Run it",
    "",
    "One file and no repository: this release's `docker/compose.published.yaml` runs the four images beside PostgreSQL with",
    "pgvector (its header lists every setting a `.env` beside it may give).",
    "",
    "```bash",
    "mkdir orbit-web && cd orbit-web",
    `curl -fsSL ${compose} -o compose.yaml`,
    "docker compose pull && docker compose up -d",
    "docker compose exec orbit-web node /opt/orbit-web/apps/api/dist/cli/governance.js owner setup-code",
    "```",
    "",
    "Then open http://localhost:3000 and set the first administrator up with that code.",
    "",
  ].join("\n");
}

function notes() {
  const version = opt("version");
  const parsed = digestsOf(opt("digests"));
  if (parsed.missing) {
    process.stderr.write(`release: no sha256 digest for ${parsed.missing.join(", ")} (--digests=<image>=sha256:…,…)\n`);
    process.exit(1);
  }
  const section = changelogSection(readFileSync(join(REPO, "CHANGELOG.md"), "utf8"), version) ?? "";
  const plugin = json(join(REPO, ".claude-plugin", "plugin.json")).version;
  process.stdout.write(`${releaseNotes({ section, version, registry: opt("registry"), repository: opt("repository"), commit: opt("commit"), digests: parsed.digests, latest: opt("latest") === "true", plugin })}\n`);
}

function main(command) {
  if (command === "verify") return verify(opt("version"));
  if (command === "notes") return notes();
  process.stderr.write("usage: release.mjs verify --version=<v> | notes --version=<v> --registry=<ghcr.io/owner> --repository=<owner/repo> --commit=<sha> --digests=<image>=sha256:…,… [--latest=true]\n");
  process.exit(2);
}

// Run as a command (a symlinked path such as macOS's /tmp included), never when a test imports it.
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv[2]);
