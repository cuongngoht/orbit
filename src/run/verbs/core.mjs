// The engine's own behaviours, and the only place they are named.
//
// Static imports on purpose: these ship with the engine, they are not discovered,
// and a directory scan would make "which verbs exist" depend on what is on disk.
// What changed is that they now go through the same register() an extension does,
// so there is one contract and one set of checks rather than a privileged core
// path and a second-class one.
import { createExecutorRegistry } from "./registry.mjs";
import api from "./api.mjs";
import call from "./call.mjs";
import as from "./as.mjs";
import assert from "./assert.mjs";
import click from "./click.mjs";
import fill from "./fill.mjs";
import goto from "./goto.mjs";
import press from "./press.mjs";
import report from "./report.mjs";
import screenshot from "./screenshot.mjs";
import skipIf from "./skip-if.mjs";
import sql from "./sql.mjs";
import wait from "./wait.mjs";

export const CORE_EXECUTORS = [goto, click, fill, press, wait, assert, skipIf, screenshot, report, api, sql, as, call];

// Seeded, never sealed: the composition root registers this project's extensions
// into the same registry afterwards and calls agree() when nothing more is
// coming. Handed a vocabulary with extension verbs in it, this leaves them
// unregistered and agree() is what says so.
export function coreExecutors(dsl) {
  const registry = createExecutorRegistry(dsl);
  for (const impl of CORE_EXECUTORS) registry.register(impl, "core");
  return registry;
}
