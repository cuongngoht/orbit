#!/usr/bin/env node
// THE SMOKE TEST'S STAND-IN FOR A CLAUDE ACCOUNT SIGN-IN. Orbit Web answers nothing but its sign-in until the Claude CLI
// is signed in to a Claude account, and a real sign-in needs a person in a browser. So, for the checks that need the
// API open (the state a person writes, kept across a restart), the smoke test mounts this read-only and names it with
// ORBIT_WEB_CLAUDE_BIN: `claude auth status` answers a Claude account sign-in, and every other command is the real
// Claude Code CLI of the image. It is test-only: it is not in the image, and the checks that used it say so.
import { spawnSync } from "node:child_process";

const REAL = "/opt/claude/bin/claude";
const args = process.argv.slice(2);

if (args[0] === "auth" && args[1] === "status") {
  process.stdout.write(`${JSON.stringify({ loggedIn: true, authMethod: "claude.ai", apiProvider: "firstParty", email: "smoke@example.com", orgName: "Orbit Web smoke test", subscriptionType: "stand-in" })}\n`);
} else {
  const r = spawnSync(REAL, args, { stdio: "inherit" });
  process.exit(r.status ?? 1);
}
