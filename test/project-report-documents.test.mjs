// Planning documents are read as they were at the cut-off: out of Git, at the
// last commit before it -- so a report about August never reads a story that
// was marked done in September. A tree that is not in Git is read as it is
// now, and says so.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { prepareDocs } from "../src/project-report/documents.mjs";
import { createProcess } from "../src/process/index.mjs";
import { realIo } from "../src/store/io.mjs";
import { sealed } from "./home.mjs";
import { tempBase } from "./project-report/rctx.mjs";

const git = (cwd, args, date) => spawnSync("git", args, { cwd, env: sealed({ GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.test", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.test" }), encoding: "utf8" });

function committed(dir, file, text, date) {
  writeFileSync(join(dir, file), text);
  git(dir, ["add", "-A"], date);
  return git(dir, ["commit", "-q", "-m", `edit ${file}`], date);
}

test("documents in Git are read at the last commit before the cut-off, never after", (t) => {
  const base = tempBase(t);
  const repo = join(base, "repo");
  mkdirSync(join(repo, "docs", "stories"), { recursive: true });
  git(repo, ["init", "-q"], "2026-07-01T00:00:00Z");
  committed(repo, "docs/stories/1-1.md", "# Story 1.1: Sign in\n\nStatus: in-progress\n", "2026-07-10T00:00:00Z");
  committed(repo, "docs/stories/1-1.md", "# Story 1.1: Sign in\n\nStatus: done\n", "2026-09-05T00:00:00Z");
  const into = join(base, "prepared");
  const got = prepareDocs({ root: repo, path: "docs", cutoffUtc: "2026-08-31T17:00:00.000Z", into, io: realIo(), process: createProcess() });
  assert.equal(got.ok, true, got.reason);
  assert.equal(got.pointInTime, true);
  assert.match(got.commit, /^[a-f0-9]{40}$/);
  assert.match(readFileSync(join(into, "stories", "1-1.md"), "utf8"), /Status: in-progress/, "September's 'done' is not what August saw");
});

test("no commit before the cut-off is said, and a tree outside Git is read as it is now, labelled so", (t) => {
  const base = tempBase(t);
  const repo = join(base, "repo");
  mkdirSync(join(repo, "docs"), { recursive: true });
  git(repo, ["init", "-q"], "2026-09-01T00:00:00Z");
  committed(repo, "docs/prd.md", "# PRD\n", "2026-09-10T00:00:00Z");
  const early = prepareDocs({ root: repo, path: "docs", cutoffUtc: "2026-08-31T17:00:00.000Z", into: join(base, "a"), io: realIo(), process: createProcess() });
  assert.deepEqual([early.ok, /no commit before the cut-off/.test(early.reason)], [false, true]);
  const loose = join(base, "loose");
  mkdirSync(join(loose, "docs"), { recursive: true });
  writeFileSync(join(loose, "docs", "epics.md"), "# Epics\n");
  const now = prepareDocs({ root: loose, path: "docs", cutoffUtc: "2026-08-31T17:00:00.000Z", into: join(base, "b"), io: realIo(), process: createProcess() });
  assert.deepEqual([now.ok, now.pointInTime, now.files], [true, false, 1]);
  assert.match(now.reason, /not in Git, so it was read as it is now/);
});

test("a documents path cannot leave the checkout", (t) => {
  const base = tempBase(t);
  assert.throws(() => prepareDocs({ root: join(base, "repo"), path: "../outside", cutoffUtc: "2026-08-31T17:00:00.000Z", into: join(base, "x"), io: realIo(), process: createProcess() }), /must stay inside/);
});
