// RESTORING a task's dependencies, in the task's workspace, under a person's standing trust.
//
// Fetching what a unit's manifests pin can run code the project did not write (install scripts), so a task
// never decides to do it. What is restored, and by which tool, is the CATALOG's to say (it is a row of
// catalog/runtimes.json, implied by the lock file or by the unit's ecosystem); what is trusted is a PERSON's,
// by fingerprint of exactly what would run: the argument list, where it runs, and what the manifest and lock
// file hold. Edit the lock file and the fingerprint moves and the trust is void.
//
// It runs argv-only through the Process port, only inside the workspace -- the checkout itself is never a
// working directory here -- with the base environment and the names a person listed for the component, and
// what it prints is clipped, scrubbed and kept in the sandbox's own room: never in a document, never in a
// journal, and never read back into a decision.
import { join } from "node:path";
import { canonicalJson, sha } from "../../hash.mjs";
import { scrub } from "../../scrub.mjs";
import { childEnv } from "../../process/env.mjs";
import { contained } from "../../project/boundary.mjs";
import { isTrusted } from "./policy.mjs";

export const RESTORE_TIMEOUT_MS = 15 * 60 * 1000;
export const RESTORE_OUTPUT_BYTES = 16 * 1024 * 1024;
export const MAX_RESTORE_LOG = 256 * 1024;

// The restore plan a component has, or null: what to run, where, and which files its trust rests on.
export const planOf = (component) => (component.restore ? { component: component.key, argv: component.restore.argv, cwd: component.restore.cwd ?? ".", requires: component.restore.runner, scope: component.restore.scope ?? [] } : null);

// What the plan would run, as one fingerprint: the arguments, where, and every file it rests on as the index
// holds it (a blob, so it is the content and nothing the checkout's line endings changed). A file the index
// cannot name makes the fingerprint null, and nothing with no fingerprint is ever trusted.
export function fingerprintOf(plan, source) {
  const printed = source.fingerprints(plan.scope);
  if (!printed || plan.scope.some((p) => !printed[p])) return null;
  return sha(canonicalJson({ argv: plan.argv, cwd: plan.cwd, files: Object.fromEntries(plan.scope.map((p) => [p, printed[p].hash])) }));
}

// What stands between a plan and running it. Ordered; the first row that matches decides; the last always does.
export const RESTORE_TRUST = [
  { name: "NO_PRINT", when: (c) => c.fingerprint === null, run: false, needs: "environment", say: (c) => `what ${c.plan.component} would restore cannot be fingerprinted (a manifest or lock file the workspace does not hold), so it is not run` },
  { name: "SKIPPED", when: (c) => c.done === c.fingerprint, run: false, needs: null, say: (c) => `${c.plan.component}'s dependencies were restored at this fingerprint already` },
  { name: "MANUAL", when: (c) => c.policy.restore.mode === "manual", run: false, needs: null, say: (c) => `restoring is manual on this machine, so ${c.plan.component}'s dependencies are not restored for it: restore them in its workspace yourself, or let a person set restore to approved in Orbit Control` },
  { name: "UNTRUSTED", when: (c) => !isTrusted(c.policy, "restore", c.fingerprint), run: false, needs: "person", say: (c) => `restoring ${c.plan.component} (${c.plan.argv.join(" ")}) is not trusted on this machine: fetching dependencies can run code they carry. A person trusts fingerprint ${c.fingerprint} in Orbit Control (Runtime → Sandbox policy)` },
  { name: "TRUSTED", when: () => true, run: true, needs: null, say: (c) => `restoring ${c.plan.component} is trusted at fingerprint ${c.fingerprint}` },
];

export const trustOf = (c) => RESTORE_TRUST.find((r) => r.when(c));

// Run one trusted plan in the workspace. -> { ok, status, durationMs, log }, the log being text for the room.
export function restore(ctx, plan, envNames) {
  const started = ctx.clock();
  const r = ctx.process.run(plan.argv[0], plan.argv.slice(1), { cwd: contained(ctx.root, join(ctx.root, plan.cwd)), env: childEnv(ctx.env ?? {}, envNames), timeoutMs: RESTORE_TIMEOUT_MS, maxBuffer: RESTORE_OUTPUT_BYTES });
  return { ok: r.ok === true, status: r.status ?? null, durationMs: ctx.clock() - started, log: clipped(r) };
}

const clipped = (r) => scrub(`${r.out ?? ""}${r.err ? `\n${r.err}` : ""}${r.error ? `\n${r.error}` : ""}`).slice(-MAX_RESTORE_LOG);
