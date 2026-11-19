#!/usr/bin/env node
// THE ACCEPTANCE RUN'S STAND-IN FOR GITHUB. Mounted read-only into the container and named by ORBIT_WEB_GH_BIN, it
// answers the few gh commands Orbit Web runs, about ONE local repository (/fixture/sum-fixture.git), so the run
// exercises everything after GitHub -- the real Orbit Web, the real Claude Code with the real Orbit plugin, real git --
// without a GitHub account. It is test-only: it is not in the image, and a run that used it says GitHub was NOT
// exercised (the real sign-in, listing and clone stay a person's manual check).
import { spawnSync } from "node:child_process";

const LOGIN = "orbit-acceptance";
const REPO = { full_name: "acceptance/sum-fixture", name: "sum-fixture", owner: "acceptance", private: true, default_branch: "main", updated_at: "2026-11-19T00:00:00Z", archived: false, fork: false };
const args = process.argv.slice(2);
const has = (...words) => words.every((w) => args.includes(w));
const out = (text) => process.stdout.write(text.endsWith("\n") ? text : `${text}\n`);

if (args[0] === "--version") out("gh version 2.89.0-acceptance-stand-in");
else if (has("auth", "status")) out(JSON.stringify({ hosts: { "github.com": [{ state: "success", active: true, host: "github.com", login: LOGIN, tokenSource: "acceptance-stand-in", gitProtocol: "https" }] } }));
else if (args[0] === "api" && args.at(-1) === "user") out(JSON.stringify({ login: LOGIN, id: 1, name: "Orbit Acceptance" }));
else if (args[0] === "api" && args.some((a) => a.startsWith("user/repos"))) out(JSON.stringify(REPO));
else if (has("repo", "list")) out(JSON.stringify([{ nameWithOwner: REPO.full_name, isPrivate: true, defaultBranchRef: { name: "main" }, updatedAt: REPO.updated_at, isArchived: false, isFork: false }]));
else if (args[0] === "api" && args.some((a) => a.startsWith("repos/acceptance/sum-fixture/branches"))) out(JSON.stringify({ name: "main", protected: false, sha: null }));
else if (has("repo", "clone")) {
  const dest = args[3];
  const branch = args[args.indexOf("--branch") + 1];
  const r = spawnSync("git", ["clone", "--branch", branch, "/fixture/sum-fixture.git", dest], { stdio: "inherit" });
  process.exit(r.status ?? 1);
} else {
  process.stderr.write(`the acceptance stand-in for gh does not answer: gh ${args.join(" ")}\n`);
  process.exit(1);
}
