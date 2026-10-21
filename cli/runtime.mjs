#!/usr/bin/env node
// RUNTIME: what a checkout needs in order to run, whether THIS machine can run it, and --
// when a person asks -- an environment to run it in and the running of it.
//
//   node runtime.mjs discover [--dry] [--rescan] [--json]
//                                          read the checkout's evidence (manifests, version files,
//                                          container files, pipelines, build files) once, and keep
//                                          what it says; again only when one of them moved. Reads
//                                          no source file, runs nothing, writes nothing in the repo
//   node runtime.mjs record [<file>]       what an agent CONCLUDED from prose, one JSON object per
//                                          line (stdin when no file): kept as a hypothesis with its
//                                          reasons -- never certain, never counted, never launched.
//                                          All or nothing
//   node runtime.mjs status [--json]       understanding, how each component would run here, what is
//                                          running and whether it ANSWERS, what can be verified.
//                                          Reads only: starts, probes and writes nothing
//   node runtime.mjs doctor [--json]       asks THIS machine the tools the checkout's requirements
//                                          name (and the container host's only when it matters)
//   node runtime.mjs design [--json]       what an environment would have to change to provide what
//                                          the checkout needs: a PROPOSAL, kept for review. Writes no
//                                          file in the repository
//   node runtime.mjs proposal [<id>] [--json]
//                                          show a proposal: the files, the edits, the gaps, what no
//                                          feature can provide, the risks
//   node runtime.mjs adopt [<id>] --human  write an approved, still-true proposal's files into the
//                                          working tree, read them back and verify them. The one
//                                          command that writes the repository -- a person's only
//   node runtime.mjs validate --human [--json]
//                                          bring the environment up to see that it WORKS. Adopted is
//                                          not validated; slow, spends the machine, and can run
//                                          commands the definition names on THIS machine (an
//                                          initializeCommand runs on the host): a person's
//   node runtime.mjs prepare [--apply --human] [--json]
//                                          what making a way of running things ready would take: a
//                                          plan, which needs no one; --apply brings the environment
//                                          up, which is validate's act and a person's
//   node runtime.mjs start [--component=<key>] [--wait=<seconds>] [--json]
//                                          launch the commands a FILE declared, behind a receipt.
//                                          Installs nothing, edits nothing, kills nothing, and
//                                          never starts into a port somebody holds
//   node runtime.mjs stop [--component=<key>] [--session=<id>] [--environment] [--json]
//                                          end what Orbit started and can PROVE is its own (a
//                                          receipt, a pid, the pid's start time). Anything else is
//                                          refused and said
//   node runtime.mjs stop --release=<session> --human
//                                          a person closes a receipt that cannot be proven. Kills
//                                          nothing
//   node runtime.mjs settings [--json]     this machine's settings for the checkout
//   node runtime.mjs configure --human [--strategy=auto|native|devcontainer] [--reuse-external=true|false]
//                              [--component=<key> [--provider=native|devcontainer] [--command=<name>]
//                              [--probe=http|tcp --target=<…> [--expect=<status>]]
//                              [--env=<NAME,NAME>] [--clear]]
//                              [--retry-attempts=<1-10>] [--retry-interval-ms=<250-30000>] [--retry-timeout-ms=<250-30000>]
//                              [--reach=<id> [--label=<text>] [--address=<name|address>] [--port=<n>]
//                              [--required-by=<key,key>] [--check-from=native,devcontainer]
//                              [--before-start=true|false] [--note=<text>] [--retry-…] [--remove-reach]]
//                                          a person's choice among the ways that WORK. Never a
//                                          command, never a secret, never a way to force one. A
//                                          reach target is a host and a port a component needs and
//                                          Orbit does not run -- never a URL, a credential or a
//                                          command. Its host is --address, because --host and
//                                          --protocol choose the HOST on every Orbit command; the
//                                          --retry-… flags with --reach are that
//                                          target's own policy. An --env value a dev container is
//                                          handed travels on the exec client's stdin, never on a
//                                          command line
//   node runtime.mjs connectivity [--json]
//                                          what each reach target last answered, FROM EACH LOCATION
//                                          it is checked from (this machine, the dev container): did
//                                          the name resolve, did the port accept, when, after how many
//                                          attempts -- STALE when it is too old to stand for now.
//                                          Reads only: asks the network nothing
//   node runtime.mjs check <target> [--from=native|devcontainer] [--json]
//                                          ONE attempt from each location (or the one named): a name
//                                          lookup and one TCP connection to the host and port a
//                                          person set. Outbound traffic; never a login
//   node runtime.mjs retry <target> [--from=native|devcontainer] [--json]
//                                          the saved retry policy, now: bounded attempts, stopped at
//                                          the first answer that settles it. Nothing retries in the
//                                          background, and nothing above the engine loops
//   node runtime.mjs sandboxes [--json]    the SANDBOXES a task owns in this checkout -- where its
//                                          application runs, from its workspace, apart from yours --
//                                          and the ports leased on this machine. Reads only
//   node runtime.mjs sandbox --task=<tsk> [--json]
//                                          one task's sandbox: the tree it was built from and whether
//                                          the workspace still is that, each component's provider,
//                                          port and readiness, what it owns, the servers it depends
//                                          on and how they are classified. Never a path
//   node runtime.mjs sandbox-prepare --task=<tsk> [--json]
//                                          make the sandbox from the task's workspace: understand it,
//                                          restore its dependencies and bring up its container ONLY
//                                          under a trust a person gave in Orbit Control, lease a port
//                                          for a component that can be told one. Idempotent; BLOCKED
//                                          names who has to act. Touches nothing of your checkout
//   node runtime.mjs sandbox-start --task=<tsk> [--component=<key>] [--wait=<seconds>] [--json]
//                                          prepare it if it is not, end what it ran of another
//                                          tree (its own sessions only), and start what it placed.
//                                          Never reuses an application you are running
//   node runtime.mjs sandbox-stop --task=<tsk> [--json]
//                                          end the sessions the sandbox owns, by the same proof stop
//                                          needs. Nothing else
//   node runtime.mjs sandbox-release --task=<tsk> [--json]
//                                          stop what it owns, let go of its port leases and stop the
//                                          containers that carry its labels. The workspace stays
//   node runtime.mjs sandbox-logs --task=<tsk> --session=<rs-id> [--stream=out|err] [--tail=<n> | --from=<byte offset>] [--json]
//                                          the last lines of one of ITS sessions' logs, scrubbed
//   node runtime.mjs sandbox-dispatch --task=<tsk> --run=<id> [--deadline-ms=<n>] [--request=<file>] [--json]
//                                          ONE generated test, to an ISOLATED sandbox's worker: a container of the
//                                          pinned, trusted worker image on the task's internal network, held to the
//                                          isolation profile before it starts, its request on stdin (or --request),
//                                          stopped by its receipt when the deadline passes. Decides no verdict: the
//                                          worker's envelope is the host's to validate
//   node runtime.mjs sandbox-signal --task=<tsk> --signal=pause|resume|cancel [--by=<who>] [--why=<text>] [--json]
//                                          a pause, resume or cancel for the sandbox's supervisor; interrupts nothing
//                                          by itself
//   node runtime.mjs trust --restore=<fingerprint> | --definition=<fingerprint> | --topology=<fingerprint>
//                          | --worker-image=<fingerprint> | --adapter-image=<fingerprint> [--revoke] --revision=<rev>
//                                          Orbit Control's door, not a terminal's: a standing
//                                          permission to restore a dependency plan, build a
//                                          container definition, run an isolated topology or run a
//                                          worker or adapter image for autonomous use, kept by the
//                                          fingerprint of exactly what would run. A terminal cannot
//                                          prove a person, so this refuses here and works from the
//                                          Runtime page in Control
//   node runtime.mjs projects [--json]     every project and checkout Orbit knows on this machine,
//                                          from what was last said about each. Asks nothing of any
//                                          checkout
//   node runtime.mjs forget <directory|id> --human
//                                          a person takes a checkout whose directory is GONE off this
//                                          machine's list. What Orbit kept about it stays in the store
//
// MEMORY FIRST. `discover` decides whether anything has to be read and says so; a checkout whose
// evidence has not moved costs a listing and a fingerprint. Native needs no container: a Dev
// Container is optional, designed only on request, written only when a person adopts it, and
// started only when it was validated. A checkout may run HYBRID -- one component on this machine,
// another in the container -- and a reach target is asked about from each place on its own: the
// host reaching a server says nothing about the container reaching it. Orbit controls no VPN.
//
// This file is the one COMPOSITION ROOT: the Process port, the probe, the machine's tools, the
// source tree and the working tree are bound in skills/orbit-runtime/bind.mjs, so nothing
// under src/runtime/ reads an environment variable, spawns a process or opens a socket itself.
//
// Exit 0 = done (a project that cannot be understood or run here is a state, never a failure) ·
// 2 = REFUSED (bad usage, an unknown id, a stale proposal, nothing person-relayed) · 3 = BLOCKED
// (nothing could be started, a store that cannot be written). Never 1: this asks the product
// nothing, so it can never find the product wrong.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { commandEnvironment } from "../skills/orbit-learn/hosts/settings.mjs";
import { bindRuntime, bindSandbox } from "../skills/orbit-runtime/bind.mjs";
import { Refused } from "../src/errors.mjs";
import { flag } from "../src/learn/args.mjs";
import { short } from "../src/hash.mjs";
import { command } from "../src/project/command.mjs";
import { switchOf } from "../src/project/env.mjs";
import { storeBase } from "../src/project/repository.mjs";
import { printable } from "../src/printable.mjs";
import { COMMANDS } from "../src/runtime/index.mjs";
import { createRegistry } from "../src/store/registry.mjs";
import { stateRooms } from "../src/store/control.mjs";
import { realIo } from "../src/store/io.mjs";
import { createEmitter } from "../src/trace/emit.mjs";
import { traceLog } from "../src/trace/log.mjs";

const ENV = commandEnvironment(process.env, process.argv);
const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const [cmd, ...args] = process.argv.slice(2);

async function main() {
  const entry = COMMANDS[cmd];
  return entry ? ran(entry) : help();
}

// What a command is bound to: the machine, one task's sandbox (`--task`), or this checkout's runtime.
function bound(entry) {
  if (entry.needs === "machine") return machineOnly();
  if (!entry.about) return bindRuntime({ pluginRoot: PLUGIN_ROOT, env: ENV, cwd: process.cwd() });
  return bindSandbox({ pluginRoot: PLUGIN_ROOT, env: ENV, cwd: process.cwd(), task: flag(args, "task") ?? refusedWithoutTask() });
}

function refusedWithoutTask() {
  throw new Refused("a sandbox is a task's: name it with --task=<tsk-…>");
}

async function ran(entry) {
  const ctx = bound(entry);
  const result = await entry.run(ctx, args);
  printed(entry, result);
  emitted(ctx, result);
}

// What a person reads is made printable first: it carries what a checkout's files said, and a
// terminal obeys an escape sequence. `--json` escapes every control character already.
const printed = (entry, result) => console.log(args.includes("--json") ? JSON.stringify(result, null, 2) : printable(entry.say(result)));

// `projects` is about every checkout and none in particular: it needs the machine store and
// the bindings in it, never a repository.
const machineOnly = () => ({ registry: createRegistry(stateRooms(storeBase(process.env)), realIo()) });

// ---- the session trail: counts and ids, never a path, a command or a fact -------------------

const EVENTS = {
  discover: (r) => ["runtime.discovered", { decision: r.decision.name, state: r.state, facts: r.facts, gaps: r.gaps.length }],
  adopt: (r) => ["runtime.proposal.adopted", { proposal: r.instance.proposal, state: r.instance.state, files: r.files.length }],
  start: (r) => ["runtime.started", { started: r.started.length, reused: (r.reused ?? []).length, skipped: r.skipped.length, blocked: r.blocked.length }],
  stop: (r) => ["runtime.stopped", { stopped: r.stopped.length, refused: r.refused.length, released: r.released.length }],
  check: (r) => ["runtime.connectivity.checked", checked(r)],
  retry: (r) => ["runtime.connectivity.checked", checked(r)],
};

// How many locations were asked, how many answered, and how many attempts it took -- never the target, a host or a port.
const checked = (r) => ({ mode: r.mode, locations: Object.keys(r.results).length, reachable: Object.values(r.results).filter((o) => o.state === "REACHABLE").length, attempts: Object.values(r.results).reduce((n, o) => n + o.attemptsUsed, 0) });

function emitted(ctx, result) {
  const event = EVENTS[cmd]?.(result);
  if (event && switchOf(ENV, "TRACE", "trace", true)) quietly(() => emitterFor(ctx.project).call(null, ...event));
}

function emitterFor(project) {
  const io = realIo();
  const emit = createEmitter({ log: traceLog(stateRooms(storeBase(process.env)), io), now: io.now, session: ENV.ORBIT_SESSION ?? null, meta: ENV.ORBIT_HOST_PROTOCOL === "2" ? { v: 2, agentHost: ENV.ORBIT_HOST } : {}, project: short(project?.storeKey ?? `root:${project?.root ?? "?"}`, 12) });
  return (type, data) => emit(type, data);
}

function quietly(fn) {
  try { return fn(); }
  catch { return null; }
}

// The usage is this file's own leading comment, so it cannot drift from it. A command that is not
// one of them is bad usage (2); no command at all, or --help, is a request for the usage (0).
function help() {
  const lines = readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(1);
  const end = lines.findIndex((l) => !l.startsWith("//"));
  console.log(lines.slice(0, end).join("\n"));
  process.exitCode = cmd && cmd !== "--help" ? 2 : 0;
}

command(main);
