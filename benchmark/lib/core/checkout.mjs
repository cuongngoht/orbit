// THE CHECKOUT a runner is handed: the subject -- exactly the frozen files, with a variant's mutations already in them --
// as a repository of its own with ONE commit, made by this harness with a fixed identity and date. It carries no
// history, so nothing in it says what the source was before a fault was planted, and the same subject is always the
// same commit. Orbit, inside the runner, treats it as the developer's checkout: it clones it and never writes it (it is
// mounted read-only), so the developer's own checkout is never mounted anywhere.
//
//   madeCheckout(dir, entries, label, env) -> { dir, commit, files }
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { Blocked } from "../../../src/errors.mjs";
import { gitOwn } from "./git.mjs";
import { writtenTree } from "./freeze.mjs";

// Where Claude Code writes the editor types of a plugin it loads; a runner mounts a small tmpfs here, so the directory
// must exist in the read-only checkout (it is ignored by the source's own .gitignore, and empty).
export const PLUGIN_TYPES = join(".claude-plugin", "types");

const done = (r, what) => {
  if (!r.ok) throw new Blocked(`the subject's repository could not ${what}: ${r.err || `git exited ${r.status}`}`);
  return r.out;
};

function committed(dir, label, env) {
  done(gitOwn(dir, ["init", "-q", "--initial-branch=subject"], env), "be created");
  done(gitOwn(dir, ["add", "-A", "-f"], env), "take its files");
  done(gitOwn(dir, ["commit", "-q", "--no-verify", "-m", label], env), "be committed");
  return done(gitOwn(dir, ["rev-parse", "HEAD"], env), "name its commit").trim();
}

const listed = (dir, env) => done(gitOwn(dir, ["ls-files", "-z"], env), "list its files").split("\0").filter(Boolean).length;

// `o.plugin: false` for a checkout that is a target, never a plugin: it needs no mount point for the host's types.
export function madeCheckout(dir, entries, label, env, o = { plugin: true }) {
  writtenTree(dir, entries);
  const commit = committed(dir, label, env);
  if (listed(dir, env) !== entries.length) throw new Blocked(`the subject's repository holds ${listed(dir, env)} files and the subject has ${entries.length}`);
  if (o.plugin !== false) mkdirSync(join(dir, PLUGIN_TYPES), { recursive: true });
  return { dir, commit, files: entries.length };
}
