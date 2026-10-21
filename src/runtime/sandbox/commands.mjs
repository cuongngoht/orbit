// The sandbox COMMANDS, in the table's own shape (src/runtime/index.mjs):
//
//   run(ctx, args)   answers with DATA. A command that is ABOUT a sandbox takes a SANDBOX context
//                    (`bindSandbox`); one about every sandbox of a checkout takes a person's
//   say(data)        puts it in words
//   writes           what it touches, which the governance table says too and a test holds equal
//   needs            `checkout`: the composition root derives the sandbox from `--task=<tsk>`
//
// A command given the wrong kind of context says which, never reads something else instead: a sandbox
// command run on a person's context would otherwise act on the person's runtime, which is exactly the mix-up a
// sandbox exists to prevent.
import { Refused } from "../../errors.mjs";
import { flag, has, words } from "../../learn/args.mjs";
import { deps } from "../lifecycle/deps.mjs";
import { launched } from "./launch.mjs";
import { prepared } from "./prepare.mjs";
import { reconciled } from "./reconcile.mjs";
import { released } from "./release.mjs";
import { trust } from "./trust.mjs";
import { dispatched } from "./dispatch.mjs";
import { signalled, supervisionRoom } from "./supervise.mjs";
import { logsOf, sandboxView, sandboxesView } from "./view.mjs";
import { sayDispatched, saySandbox, saySandboxes, saySignalled, sayLaunched, sayLogs, sayPrepared, sayReleased, sayStopped, sayTopology, sayTrusted } from "./views.mjs";
import { stop } from "../lifecycle/stop.mjs";
import { recomposed } from "./isolated-launch.mjs";

const ABOUT_ONE = "this is about ONE task's sandbox: name it with --task=<tsk-…> (and run from the checkout it belongs to)";

const sandboxed = (ctx) => {
  if (!ctx.sandboxDoc) throw new Refused(ABOUT_ONE);
  return ctx;
};

// A closure is the components and servers what is about to be tested needs: `--closure=<key,key>` names components by
// key and servers by their compose name. Absent, everything the workspace declares.
const closureOf = (args) => ((list) => (list ? { components: list, services: list } : null))(flag(args, "closure")?.split(",").map((k) => k.trim()).filter(Boolean));

const prepare = async (ctx, args = []) => {
  reconciled(sandboxed(ctx), { apply: true });
  return prepared(ctx, deps(ctx), { closure: closureOf(args) });
};

// One generated test, to the sandbox's worker: the request is read from --request=<file>, or stdin.
const dispatch = (ctx, args) => dispatched(sandboxed(ctx), { run: flag(args, "run"), deadlineMs: flag(args, "deadline-ms"), input: ctx.read?.(flag(args, "request")) ?? "" }, deps(ctx));

// A signal the roots that own a cancel write: pause, resume, cancel.
const signal = (ctx, args) => ({ environment: sandboxed(ctx).envId, signal: signalled(ctx.io, supervisionRoom(ctx.rooms.liveSandbox), { signal: flag(args, "signal"), by: flag(args, "by") ?? "terminal", why: flag(args, "why") ?? "" }, ctx.now()) });

const launch = (ctx, args) => launched(sandboxed(ctx), { component: flag(args, "component"), wait: flag(args, "wait") === undefined ? undefined : Number(flag(args, "wait")) }, deps(ctx));

const view = (ctx) => sandboxView(sandboxed(ctx));

const stopped = (ctx) => stop(sandboxed(ctx), {});

const release = (ctx) => released(sandboxed(ctx), deps(ctx));

const logs = (ctx, args) => logsOf(sandboxed(ctx), flag(args, "session"), { stream: flag(args, "stream"), tail: flag(args, "tail"), from: flag(args, "from") });

const listed = (ctx) => sandboxesView(ctx);

// What the sandbox's topology is NOW -- each node's key, role, alias on the task's network, ports, the
// catalog service it runs and what it was started with -- for the host's binder
// (src/runtime/sandbox/bindings.mjs); composed exactly as a dispatch composes it, gated the same way.
const topologyOf = (ctx) => ((now) => (now.needs ? { environment: ctx.envId, needs: now.needs, say: now.say } : { environment: ctx.envId, mode: now.topology.mode, fingerprint: now.topology.fingerprint, nodes: now.topology.nodes.map(nodeOf) }))(recomposed(sandboxed(ctx), deps(ctx)));

const nodeOf = (n) => ({ key: n.key, role: n.role, name: n.name, alias: n.alias, service: n.service ?? null, ports: n.ports ?? [], argv: n.argv ?? [], compose: { env: n.compose?.env ?? [] }, env: { names: n.env?.names ?? [], values: n.env?.values ?? {} } });

// Which kind of trust a flag names, in the table's order: the first one given.
const TRUST_FLAGS = ["restore", "definition", "topology", "worker-image", "adapter-image"];

const trustFlagOf = (args) => TRUST_FLAGS.find((k) => flag(args, k) !== undefined) ?? "definition";

const trusted = (ctx, args) => ({ saved: trust(ctx, { kind: trustFlagOf(args), fingerprint: flag(args, trustFlagOf(args)), revoke: has(args, "revoke"), revision: flag(args, "revision") ?? null }) });

export const SANDBOX_COMMANDS = {
  sandboxes: { run: listed, say: saySandboxes, writes: "nothing", needs: "checkout" },
  sandbox: { about: "task", run: view, say: saySandbox, writes: "nothing", needs: "checkout" },
  "sandbox-prepare": { about: "task", run: prepare, say: sayPrepared, writes: "machine", needs: "checkout" },
  "sandbox-start": { about: "task", run: launch, say: sayLaunched, writes: "machine", needs: "checkout" },
  "sandbox-stop": { about: "task", run: stopped, say: sayStopped, writes: "machine", needs: "checkout" },
  "sandbox-release": { about: "task", run: release, say: sayReleased, writes: "machine", needs: "checkout" },
  "sandbox-logs": { about: "task", run: logs, say: sayLogs, writes: "nothing", needs: "checkout" },
  "sandbox-dispatch": { about: "task", run: dispatch, say: sayDispatched, writes: "machine", needs: "checkout" },
  "sandbox-signal": { about: "task", run: signal, say: saySignalled, writes: "store", needs: "checkout" },
  "sandbox-topology": { about: "task", run: topologyOf, say: sayTopology, writes: "nothing", needs: "checkout" },
  trust: { run: trusted, say: sayTrusted, writes: "store", needs: "checkout" },
};

// `words` is re-exported so the table's file is the only place that knows how a sandbox command reads its arguments.
export { words };
