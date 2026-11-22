// What the image was built with, written once at build time and read by GET /api/setup/status: Orbit Web's version,
// the Orbit plugin's version and commit, and the versions the bundled CLIs report.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// A scratch home, removed afterwards: asking a CLI its version must leave nothing in the image.
const scratch = mkdtempSync(join(tmpdir(), "build-info-"));
const env = { PATH: process.env.PATH, HOME: scratch, CLAUDE_CONFIG_DIR: scratch, GH_CONFIG_DIR: scratch, CODEX_HOME: scratch, DISABLE_AUTOUPDATER: "1" };

const version = (file, args = ["--version"]) => {
    try {
    return /\b(\d+\.\d+\.\d+(?:[-.][0-9A-Za-z.]+)?)\b/.exec(execFileSync(file, args, { encoding: "utf8", env }))?.[1] ?? null;
  } catch {
    return null;
  }
};

const plugin = JSON.parse(readFileSync("/opt/orbit/plugin/.claude-plugin/plugin.json", "utf8"));
const info = {
  web: process.argv[2] ?? null,
  orbit: plugin.version ?? null,
  orbitCommit: readFileSync("/opt/orbit/commit", "utf8").trim(),
  claude: version("claude"),
  codex: version("codex"),
  agy: version("agy"),
  gh: version("gh"),
  git: version("git"),
  az: version("az", ["version", "--output", "json"]),
  python: version("python3"),
  node: process.versions.node,
};
rmSync(scratch, { recursive: true, force: true });
process.stdout.write(`${JSON.stringify(info, null, 2)}\n`);
