#!/usr/bin/env node
// THE HOLD: what a task container runs in place of an agent when the agent runs on the HOST (a mini-SWE-agent arm). It
// says it is ready and waits, so the container stays up while the host's agent runs its commands in it by `docker exec`;
// the controller ends it by creating /opt/evalrun/release, and the entry then records that the agent's time ended, as
// for any agent. It does nothing else. Copied into the container alone.
//
//   node hold.mjs        stdout: one line {"type":"hold","ready":true}
import { existsSync } from "node:fs";

export const RELEASE = "/opt/evalrun/release";

process.stdout.write(`${JSON.stringify({ type: "hold", ready: true })}\n`);
const timer = setInterval(() => (existsSync(RELEASE) ? (clearInterval(timer), process.exit(0)) : null), 250);
