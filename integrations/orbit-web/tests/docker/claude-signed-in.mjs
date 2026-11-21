#!/usr/bin/env node
// THE SMOKE TEST'S STAND-IN FOR A CLAUDE ACCOUNT SIGN-IN. Orbit Web answers nothing but its sign-in until a BROWSER has
// finished a sign-in with a Claude account, and a real sign-in needs a person in a browser. So, for the checks that need
// the API open (the state a person writes, kept across a restart), the smoke test mounts this read-only and names it with
// ORBIT_WEB_CLAUDE_BIN: `claude auth status` answers a Claude account sign-in, `claude auth login` prints a sign-in URL
// and the prompt and takes whatever code it is given (so the smoke test goes through Orbit Web's real browser sign-in:
// its nonce, its code, the exchange for a session), and every other command is the real Claude Code CLI of the image.
// It is test-only: it is not in the image, and the checks that used it say so.
import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline";

const REAL = "/opt/claude/bin/claude";
const args = process.argv.slice(2);

if (args[0] === "auth" && args[1] === "status") {
  process.stdout.write(`${JSON.stringify({ loggedIn: true, authMethod: "claude.ai", apiProvider: "firstParty", email: "smoke@example.com", orgId: "org-smoke", orgName: "Orbit Web smoke test", subscriptionType: "stand-in" })}\n`);
} else if (args[0] === "auth" && args[1] === "login") {
  process.stdout.write("If the browser didn't open, visit: https://claude.com/cai/oauth/authorize?code=true&state=smoke\nPaste code here if prompted > ");
  const lines = createInterface({ input: process.stdin });
  lines.once("line", () => {
    process.stdout.write("\nLogin successful.\n");
    lines.close();
    process.exit(0);
  });
} else {
  const r = spawnSync(REAL, args, { stdio: "inherit" });
  process.exit(r.status ?? 1);
}
