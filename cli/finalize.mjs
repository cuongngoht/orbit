#!/usr/bin/env node
// Drain a protocol-2 session's pending engineering checkpoints (src/lifecycle/finalize.mjs): at most four, each under
// a lease, through the observer's own milestone, budget and debounce rules. No native prompt.
//
//   node cli/finalize.mjs [--host=<id> --protocol=2]   what was drained, as JSON
//   node cli/finalize.mjs --hook                       the same, silent and always exit 0 -- what a hook's
//                                                      background drain and a command's own drain run
//
// A protocol-2 session's queue lives in that session's room, so a drain finds it only when it is bound to the same
// session (ORBIT_HOST, ORBIT_HOST_PROTOCOL=2, ORBIT_SESSION), as every Orbit command such a host runs is. Only a checkout the
// machine knows is drained (src/project/repository.mjs knownCheckout), and the observer is ON unless a person turned
// it off (ORBIT_ENGINEERING_OBSERVE=off, or the engineering_observe setting).
import { join } from 'node:path';
import { command } from '../src/project/command.mjs';
import { loadProject } from '../src/project/index.mjs';
import { knownCheckout } from '../src/project/repository.mjs';
import { workingSetDir } from '../src/project/runtime.mjs';
import { realIo } from '../src/store/io.mjs';
import { engineeringContext } from '../src/engineering/context.mjs';
import { createArchitecture } from '../src/architecture/store.mjs';
import { createWorkingSet } from '../src/engineering/working-set/store.mjs';
import { finalizerStore } from '../src/lifecycle/finalizer-store.mjs';
import { drainFinalizer } from '../src/lifecycle/finalize.mjs';
import { switchOf } from '../src/project/env.mjs';
import { short } from '../src/hash.mjs';
import { storeBase } from '../src/project/repository.mjs';
import { stateRooms } from '../src/store/control.mjs';
import { createEmitter } from '../src/trace/emit.mjs';
import { traceLog } from '../src/trace/log.mjs';
import { commandEnvironment } from '../skills/orbit-learn/hosts/settings.mjs';

const HOOK = process.argv.includes('--hook');

function main() {
  const env = commandEnvironment(process.env, process.argv);
  const project = loadProject(env);
  const result = knownCheckout(project) ? drained(project, env) : [];
  if (!HOOK) console.log(JSON.stringify(result));
}

function drained(project, env) {
  const ctx = engineeringContext({ project, config: project.config }, env);
  const ws = createWorkingSet(workingSetDir(project), realIo());
  const ready = { ...ctx, now: ctx.io.now, gates: () => new Set(createArchitecture(ctx.store.root, ctx.io).all().filter((f) => f.kind === 'invariant').flatMap((f) => f.evidence ?? [])), trace: tracer(env, project) };
  return drainFinalizer(finalizerStore(join(ws.dir, 'finalizer'), ctx.io), ready, ws, switchOf(env, 'ENGINEERING_OBSERVE', 'engineering_observe', true));
}

// The session trail's `learning.observed`, bound the way every composition root binds the trail: switched by
// `trace` / ORBIT_TRACE, marked with the session and a short hash of the project, never a path.
const tracer = (env, project) => (switchOf(env, 'TRACE', 'trace', true) ? (type, data) => createEmitter({ log: traceLog(stateRooms(storeBase(env)), realIo()), now: () => new Date().toISOString(), session: env.ORBIT_SESSION ?? null, meta: env.ORBIT_HOST_PROTOCOL === '2' ? { v: 2, agentHost: env.ORBIT_HOST } : {}, project: short(project.storeKey ?? `root:${project.root}`, 12) })(type, data) : undefined);

// A hook's drain says nothing and fails nothing: what it could not do waits in the queue for the next one.
function hooked() {
  try { main(); }
  catch { /* the queue keeps what was not drained */ }
  process.exitCode = 0;
}

if (HOOK) hooked();
if (!HOOK) command(main);
