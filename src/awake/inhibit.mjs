// Keep the machine awake for exactly the lifetime of this process. A headless
// browser dies with the machine's sleep, and a 75-second wizard is long enough
// for a laptop lid to matter.
import { spawn, spawnSync } from "node:child_process";

export function stayAwake(platform = process.platform, pid = process.pid) {
  if (platform === "darwin") return caffeinate(pid);
  if (platform === "linux" && spawnSync("which", ["systemd-inhibit"]).status === 0) return inhibit();
  return null;
}

function caffeinate(pid) {
  spawn("caffeinate", ["-dis", "-w", String(pid)], { stdio: "ignore", detached: true }).unref();
  return "caffeinate -dis (display, idle, system) until this process exits";
}

function inhibit() {
  const p = spawn("systemd-inhibit", ["--what=idle:sleep", "--who=run-awake", "--why=UI test run", "sleep", "infinity"], { stdio: "ignore" });
  process.on("exit", () => p.kill());
  return "systemd-inhibit idle:sleep until this process exits";
}
