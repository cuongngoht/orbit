// What THIS MACHINE can do, as the runtime subject asks it: which of the tools a
// checkout's requirements need are here, and which version -- or whether that is
// not known.
//
// The detection is src/tools/ and nothing else: a tool is ASKED its version (argv,
// never a shell), the answer is kept in the machine-wide observation file every
// other consumer reads, and an observation older than its TTL reads as unknown.
// This module only turns a tool's answer into the three words a resolver needs --
// AVAILABLE, UNAVAILABLE, UNKNOWN -- and keeps them apart, because they are three
// different instructions to a person:
//
//   AVAILABLE     it is here, at this version
//   UNAVAILABLE   it is not (and the reason says which: a CLI that is not installed
//                 is not a daemon that is not running)
//   UNKNOWN       nothing could say -- never asked, asked too long ago, or it did
//                 not answer in time. NOT the same as unavailable, and a resolver
//                 that treats it as such sends somebody to install what is there
//
// Machine scope, never project scope: what a laptop has is true of every project
// on it, and what a project needs is no business of the laptop. So the question
// "which tools" is always asked of the RESOLVER, and only those are probed.
import { SOURCES } from "../tools/detect.mjs";
import { effectiveTools } from "../tools/effective.mjs";
import { observeSome } from "../tools/observe.mjs";

export const AVAILABLE = "AVAILABLE";
export const UNAVAILABLE = "UNAVAILABLE";
export const UNKNOWN = "UNKNOWN";

const STATES = { ready: AVAILABLE, missing: UNAVAILABLE };

const toolState = (row) => (row ? { state: STATES[row.status] ?? UNKNOWN, version: row.version ?? null, reason: row.reason ?? null, checkedAt: row.checkedAt ?? null } : { state: UNKNOWN, version: null, reason: "no tool of that name is in the catalog", checkedAt: null });

// `catalog` is the tool catalog (src/tools/catalog.mjs), `state` its state port
// (src/tools/state.mjs), `detection` what detection needs of the machine
// (src/tools/real.mjs), `now` a function answering an ISO time.
export function createMachine({ catalog, state, detection, now, platform, arch }) {
  const rows = () => effectiveTools({ catalog, desired: state.read("desired"), observed: state.read("observed"), receipts: state.receipts(), now: Date.parse(now()), platform, arch, installers: {} });
  const named = (ids) => Object.fromEntries(ids.map((id) => [id, toolState(rows().find((r) => r.id === id))]));
  return { platform, arch, cached: named, probe: (ids) => (observeSome(catalog, ids, { ...detection, state, now, receipts: state.receipts(), rooms: detection.rooms }), named(ids)) };
}

// The docker daemon is not a binary: it is whether the runtime behind the CLI
// ANSWERS. So it is a `docker-daemon` detector (src/tools/detect.mjs lets a row
// name its own strategy), asking the server's version through the CLI. Three
// outcomes, three sentences: no CLI at all, a CLI with no daemon behind it, and a
// daemon that did not answer in time -- which is `unknown`, not missing.
export function dockerDaemon(entry, ctx) {
  const system = SOURCES.find((s) => s.source === "system");
  const path = system.paths({ detection: { commands: ["docker"] } }, ctx).find((p) => ctx.exists(p));
  if (!path) return [{ source: "system", found: true, ok: false, path: null, version: null, reason: "the docker command is not installed, so there is no daemon to ask" }];
  return [{ source: "system", found: true, path, ...answered(ctx.run(path, ["version", "--format", "{{.Server.Version}}"])) }];
}

function answered(r) {
  if (r?.error?.code === "ETIMEDOUT") return { ok: false, version: null, timedOut: true, reason: "the docker daemon did not answer in time" };
  if (r?.error) return { ok: false, version: null, reason: "docker is installed but could not be started" };
  if (r?.status !== 0) return { ok: false, version: null, reason: "docker is installed, but its daemon is not reachable — it is not running, or this user may not use it" };
  return { ok: true, version: /(\d+(?:\.\d+)+)/.exec(String(r.stdout))?.[1] ?? null, reason: null };
}

export const DETECTORS = { "docker-daemon": dockerDaemon };
