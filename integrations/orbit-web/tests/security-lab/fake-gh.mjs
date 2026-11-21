#!/usr/bin/env node
// THE SECURITY LAB'S STAND-IN FOR GITHUB CLI: answers the few gh commands Orbit Web runs about ONE local repository --
// a bare repository on the lab's own volume (/fixture/remotes/acceptance/sum-fixture.git), which is also where Orbit
// Web pushes (ORBIT_WEB_GITHUB_URL=file:///fixture/remotes). No GitHub account, no network, and no real push anywhere.
// Test-only: not in the image.
import { spawnSync } from "node:child_process";

const LOGIN = "orbit-lab";
const SOURCE = "/fixture/remotes/acceptance/sum-fixture.git";
const REPO = { full_name: "acceptance/sum-fixture", name: "sum-fixture", owner: "acceptance", private: true, default_branch: "main", updated_at: "2026-11-20T00:00:00Z", archived: false, fork: false };
const args = process.argv.slice(2);
const has = (...words) => words.every((w) => args.includes(w));
const out = (text) => process.stdout.write(text.endsWith("\n") ? text : `${text}\n`);

if (args[0] === "--version") out("gh version 2.89.0-lab-stand-in");
else if (has("auth", "status")) out(JSON.stringify({ hosts: { "github.com": [{ state: "success", active: true, host: "github.com", login: LOGIN, tokenSource: "lab-stand-in", gitProtocol: "https" }] } }));
else if (has("auth", "git-credential")) process.exit(0);
else if (args[0] === "api" && args.at(-1) === "user") out(JSON.stringify({ login: LOGIN, id: 1, name: "Orbit Lab" }));
else if (args[0] === "api" && args.some((a) => a.startsWith("user/repos"))) out(JSON.stringify(REPO));
else if (has("repo", "list")) out(JSON.stringify([{ nameWithOwner: REPO.full_name, isPrivate: true, defaultBranchRef: { name: "main" }, updatedAt: REPO.updated_at, isArchived: false, isFork: false }]));
else if (args[0] === "api" && args.some((a) => a.startsWith("repos/acceptance/sum-fixture/branches"))) out(JSON.stringify({ name: "main", protected: false, sha: null }));
else if (has("repo", "clone")) {
  // gh repo clone <url> <destination> [--no-upstream] -- <git clone options>
  const dest = args[3];
  const extra = args.includes("--") ? args.slice(args.indexOf("--") + 1) : [];
  const r = spawnSync("git", ["clone", ...extra, "--", SOURCE, dest], { stdio: "inherit" });
  process.exit(r.status ?? 1);
} else {
  process.stderr.write(`the lab's stand-in for gh does not answer: gh ${args.join(" ")}\n`);
  process.exit(1);
}
