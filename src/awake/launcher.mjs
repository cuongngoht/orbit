// Open a signed-in browser through the PROJECT's launcher (project.json
// `launcher`), which must print `run directory : <dir>` and `target : <url>`.
// The four choices come from project.json (`launch`) and the environment; the
// engine never handles a credential.
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fromEnv } from "../project/env.mjs";

export const choices = (env, config) => ({ channel: config.launch.channel, mode: fromEnv(env, "MODE") || "headless", env: config.launch.env, profile: fromEnv(env, "PROFILE") || null });

export function launch(launcher, opts, profile, runDir = null, spawn = spawnSync) {
  const flags = ["--channel", opts.channel, `--${opts.mode}`, "--env", opts.env, "--profile", profile, ...(runDir ? ["--run-dir", runDir] : [])];
  const r = spawn("node", [launcher, ...flags], { encoding: "utf8" });
  return parseLaunch((r.stdout ?? "") + (r.stderr ?? ""));
}

export function parseLaunch(out) {
  const runDir = out.match(/^run directory *: *(.+)$/m)?.[1]?.trim();
  const target = out.match(/^target *: *(\S+)/m)?.[1];
  return { runDir, target, out };
}


// One run directory per identity, beside the project's default one.
export const runDirFor = (as, base) => `${base ?? join(tmpdir(), "pw")}-${as}`;
