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
import { logsOf, sandboxView, sandboxesView } from "./view.mjs";
import { saySandbox, saySandboxes, sayLaunched, sayLogs, sayPrepared, sayReleased, sayStopped, sayTrusted } from "./views.mjs";
import { stop } from "../lifecycle/stop.mjs";

const ABOUT_ONE = "this is about ONE task's sandbox: name it with --task=<tsk-…> (and run from the checkout it belongs to)";

const sandboxed = (ctx) => {
  if (!ctx.sandboxDoc) throw new Refused(ABOUT_ONE);
  return ctx;
};

const prepare = async (ctx) => {
  reconciled(sandboxed(ctx), { apply: true });
  return prepared(ctx, deps(ctx));
};

const launch = (ctx, args) => launched(sandboxed(ctx), { component: flag(args, "component"), wait: flag(args, "wait") === undefined ? undefined : Number(flag(args, "wait")) }, deps(ctx));

const view = (ctx) => sandboxView(sandboxed(ctx));

const stopped = (ctx) => stop(sandboxed(ctx), {});

const release = (ctx) => released(sandboxed(ctx), deps(ctx));

const logs = (ctx, args) => logsOf(sandboxed(ctx), flag(args, "session"), { stream: flag(args, "stream"), tail: flag(args, "tail"), from: flag(args, "from") });

const listed = (ctx) => sandboxesView(ctx);

const trusted = (ctx, args) => ({ saved: trust(ctx, { kind: has(args, "restore") || flag(args, "restore") ? "restore" : "definition", fingerprint: flag(args, "restore") ?? flag(args, "definition"), revoke: has(args, "revoke"), revision: flag(args, "revision") ?? null }) });

export const SANDBOX_COMMANDS = {
  sandboxes: { run: listed, say: saySandboxes, writes: "nothing", needs: "checkout" },
  sandbox: { about: "task", run: view, say: saySandbox, writes: "nothing", needs: "checkout" },
  "sandbox-prepare": { about: "task", run: prepare, say: sayPrepared, writes: "machine", needs: "checkout" },
  "sandbox-start": { about: "task", run: launch, say: sayLaunched, writes: "machine", needs: "checkout" },
  "sandbox-stop": { about: "task", run: stopped, say: sayStopped, writes: "machine", needs: "checkout" },
  "sandbox-release": { about: "task", run: release, say: sayReleased, writes: "machine", needs: "checkout" },
  "sandbox-logs": { about: "task", run: logs, say: sayLogs, writes: "nothing", needs: "checkout" },
  trust: { run: trusted, say: sayTrusted, writes: "store", needs: "checkout" },
};

// `words` is re-exported so the table's file is the only place that knows how a sandbox command reads its arguments.
export { words };
