// THE RELEASE WORKSPACE: where a ship integrates its verified repairs, and the pristine checkout of every release commit
// it judges -- all of it in the machine store; the person's checkout is only ever READ (a clone's source, its objects
// borrowed), never its tree and never its `.git`. The workspace is the ship task's own (src/orchestration/workspace.mjs:
// its owner written first, a clone detached at the start commit, its origin removed, no hook run); a verified patch is
// applied there with `git apply`, and the release commit is made by THE DELIVERY (src/frontend/local-clones.mjs) in a
// bare git directory beside it, never in the tree's own `.git`. Integrating is the "task's own workspace and its local
// commit" class of action -- AUTO under the Protected Boundaries (ADR 0042), asked of `authorize()` before a byte moves.
//
// world: { git(cwd, args) -> { ok, out, err }, workspaces (createWorkspaces), root (the person's checkout) }
//   prepared(world, ship) -> { path }      touchedBy(world, tree, patch) -> [{ path, added, removed, existed }]
//   integrated(world, ship, tree, patch, message) -> commit      pristine(world, room, commit, source) -> dir
//   delivered(world, room, tree, start) -> { patch, bundle }     INTEGRATION
import { existsSync } from "node:fs";
import { join } from "node:path";
import { Blocked, Refused } from "../../../src/errors.mjs";
import { authorize, isAuto } from "../../../src/protected/authorize.mjs";
import { ACTION, HOMES } from "../../../src/protected/boundaries.mjs";

// What integrating a verified repair IS, to the boundaries: a write to the task's own workspace.
export const INTEGRATION = Object.freeze({ kind: ACTION.WRITE, home: HOMES.TASK_WORKSPACE });

function autoOnly(action) {
  const verdict = authorize(action);
  if (!isAuto(verdict)) throw new Refused(`${verdict.boundary ?? "a protected boundary"} holds this write: a release ship crosses none`);
  return verdict;
}

const said = (r, what) => (r.ok ? String(r.out ?? "") : failed(what, r));

function failed(what, r) {
  throw new Blocked(`git could not ${what}: ${String(r.err ?? r.out ?? "").trim().split("\n").at(-1)?.slice(0, 300) ?? "no answer"}`);
}

export const prepared = (world, ship) => world.workspaces.prepare({ task: ship.task, project: ship.project, checkout: ship.checkout, baseRevision: ship.start.commit });

// What a patch touches, as git itself reads the patch (`apply --numstat`) -- never the list a record says it holds.
const NUMSTAT = /^(\d+|-)\t(\d+|-)\t(.+)$/;

const pathsOf = (p) => (p.includes(" => ") ? renamed(p) : [p]);

const renamed = (p) => ((m) => (m ? [`${m[1]}${m[2]}${m[4]}`, `${m[1]}${m[3]}${m[4]}`] : p.split(" => ")))(/^(.*)\{(.*) => (.*)\}(.*)$/.exec(p));

const touchedRow = (tree) => (line) => ((m) => (m ? pathsOf(m[3]).map((path) => ({ path, added: Number(m[1]) || 0, removed: Number(m[2]) || 0, existed: existsSync(join(tree, path)) })) : []))(NUMSTAT.exec(line));

export const touchedBy = (world, tree, patch) => said(world.git(tree, ["apply", "--numstat", patch]), "read the patch").split("\n").filter(Boolean).flatMap(touchedRow(tree));

// The verified patch applied in the workspace -- checked whole before anything is written -- and the release commit
// made from the workspace by the delivery: the base and every patch integrated so far.
export function integrated(world, ship, tree, patch, message) {
  autoOnly(INTEGRATION);
  said(world.git(tree, ["apply", "--check", patch]), "apply the verified patch to the release workspace (it no longer applies)");
  said(world.git(tree, ["apply", patch]), "apply the verified patch");
  return world.workspaces.commit(ship.task, `orbit/release/${ship.id}`, message);
}

// A PRISTINE checkout of one release commit, made once and reused: what a cycle's gates, artifact and benchmark rows
// are run on, so anything a check leaves in a tree is never what a run freezes.
export function pristine(world, room, commit, source) {
  const dir = room.at("trees", commit.slice(0, 12));
  if (existsSync(join(dir, ".git")) && said(world.git(dir, ["rev-parse", "HEAD"]), "read a release tree").trim() === commit) return dir;
  said(world.git(source, ["clone", "--quiet", "--no-hardlinks", "--no-checkout", "--config", "core.autocrlf=false", source, dir]), `clone ${commit.slice(0, 12)} into the ship's room`);
  said(world.git(dir, ["checkout", "--quiet", "--detach", commit]), `check out ${commit.slice(0, 12)}`);
  return (world.git(dir, ["remote", "remove", "origin"]), dir);
}

// How a person takes the qualified source into their branch, when it is not their HEAD already: a patch for `git am`
// and a bundle for `git fetch` -- written into the ship's room; nothing is pushed, nothing written into the checkout.
export function delivered(world, room, tree, start) {
  const patch = said(world.git(tree, ["format-patch", "--stdout", `${start}..HEAD`]), "write the release patch");
  room.io.write(room.at("release.patch"), patch);
  said(world.git(tree, ["bundle", "create", "--quiet", room.at("release.bundle"), `${start}..HEAD`]), "write the release bundle");
  return { patch: room.at("release.patch"), bundle: room.at("release.bundle") };
}
