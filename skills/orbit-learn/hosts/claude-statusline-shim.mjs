#!/usr/bin/env node
// Orbit Live's STATUS LINE SHIM for Claude Code. `cli/host.mjs apply --host=claude --kind=statusline` copies this
// file, byte for byte, to <store>/control/hosts/claude/statusline.mjs and names that copy in the user's
// settings.json -- because a plugin cannot ship a status line, settings.json expands no plugin variable, and the
// plugin's own directory moves with every version. The copy stays put; the engine it runs is found again on every
// call from what the host's own hook last observed (observed.json `root`, refreshed at each session start).
//
// It reads two documents beside it and nothing else. When Live is switched off for the host, when no root was
// observed, or when that root holds no engine, it prints nothing and exits 0: a status row never shows an error.
// When a person chose to keep the status line they already had (keep.json, POSIX only), that command runs first,
// with the same input, under a deadline, and its first lines are kept above Orbit's.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const KEEP_MS = 400;
const KEEP_LINES = 3;

const read = (name) => {
  try { return JSON.parse(readFileSync(join(HERE, name), "utf8")); }
  catch { return null; }
};

const stdinText = () => {
  try { return readFileSync(0, "utf8"); }
  catch { return ""; }
};

const engineOf = (root) => (typeof root === "string" && existsSync(join(root, "cli", "live.mjs")) ? join(root, "cli", "live.mjs") : null);

function kept(command, input) {
  if (typeof command !== "string" || process.platform === "win32") return [];
  const got = spawnSync("/bin/sh", ["-c", command], { input, encoding: "utf8", timeout: KEEP_MS, env: process.env });
  return got.status === 0 ? String(got.stdout).split("\n").filter((l) => l.length > 0).slice(0, KEEP_LINES) : [];
}

const input = stdinText();
const off = read("settings.json")?.settings?.live === false;
const engine = off ? null : engineOf(read("observed.json")?.root);
const previous = kept(read("keep.json")?.command, input);
if (previous.length) process.stdout.write(`${previous.join("\n")}\n`);
if (engine) {
  process.env.ORBIT_STORE_DIR = resolve(HERE, "..", "..", "..");
  process.env.ORBIT_STATUSLINE_INPUT = input;
  process.argv = [process.argv[0], engine, "statusline", "--host=claude"];
  await import(pathToFileURL(engine).href);
}
