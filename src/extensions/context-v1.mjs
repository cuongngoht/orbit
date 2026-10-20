// The PUBLIC surface an extension gets, version 1. A Facade, and a small one.
//
// Generated QC code is code nobody reviewed line by line. Handing it the real
// `ctx` would hand it the memory store, the identity port, the project's
// resolved paths, every environment variable the adapters were built from, and
// the run object whose fields decide the verdict. None of that is needed to ask
// PostgreSQL whether a row exists, and all of it is reachable the moment it is
// offered.
//
// So this is what is offered, and the list is short on purpose:
//
//   process  run one command, argv-only, never a shell
//   browser  evaluate / click / fill -- the three a verification actually needs
//   storage  a scratch directory of its own, inside the store, nowhere else
//   bindings read a ${PARAM} the run has already bound (read-only)
//   evidence record one line into this run's log
//   log      say something to the person watching
//   tools    ask whether a command is usable here
//
// What is deliberately absent: the memory store, the ledger, the notes, the
// lessons, the identity claims, process.env, the graph, and anything that can
// decide a verdict. An extension OBSERVES and REPORTS; the engine judges. A
// capability that could write the ledger could write a PASS.
//
// This is the capability boundary. This published shape is what the
// runtime has become, and it only has to because this is the only thing a v1
// extension was ever allowed to see.
import { join } from "node:path";
import { Refused } from "../errors.mjs";
import { contained } from "../project/boundary.mjs";
import { scrub } from "../scrub.mjs";

export const CONTEXT_API_VERSION = 1;

export function extensionContextV1(ctx, run, cap) {
  const who = cap?.id ?? cap?.from ?? "extension";
  return {
    apiVersion: CONTEXT_API_VERSION,
    capability: cap?.id ?? null,
    ...surfaces(ctx, run, who, cap),
  };
}

const surfaces = (ctx, run, who, cap) => ({
  process: processFacade(ctx, who, cap),
  browser: run?.page === false ? noPage(who) : browserFacade(ctx),
  storage: storageFacade(ctx, who),
  bindings: bindingsFacade(run),
  evidence: evidenceFacade(run, who),
  log: logFacade(ctx, who),
  tools: { probe: (bin) => ctx.tools.present(bin) },
});

// Named, so a log line and an evidence record say WHICH capability spawned what.
// An extension cannot forge that: it never passes the name. The capability's own
// declared timeout is the default, so a tool that hangs is killed by the number
// its author wrote down rather than running until the run's deadline is spent.
//
// Only `input` and `timeoutMs` pass through. The port itself learned `env`, `cwd`
// and `maxBuffer` in 1.6.0; forwarding whatever a capability wrote would have
// handed every v1 extension those powers without anybody deciding it should.
//
// The one thing the ENGINE adds is the environment of a capability that declared a
// `connection`: the credential a person set up, named by the variable its provider
// expects, on top of the few variables a child needs to start. It is asked for at
// each call, after the options an extension passed, so an extension can neither
// supply nor override it -- and it never appears on the surface an extension can
// read: there is no way to ASK for a secret, only a command that receives one.
const processFacade = (ctx, who, cap) => ({
  run: (file, args, opts = {}) => ctx.process.run(file, args, { ...limit(cap?.timeoutSec), ...allowed(opts), ...connected(ctx, cap), by: who }),
});

function connected(ctx, cap) {
  const env = cap?.connection && ctx.connectionEnv ? ctx.connectionEnv(cap.connection) : undefined;
  return env ? { env } : {};
}

const limit = (timeoutSec) => (timeoutSec ? { timeoutMs: timeoutSec * 1000 } : {});

const OPTIONS = ["input", "timeoutMs"];

const allowed = (opts) => Object.fromEntries(OPTIONS.filter((k) => opts?.[k] !== undefined).map((k) => [k, opts[k]]));

// Three methods, not the whole browser port. `ev` and `truthy` are how every core
// verb reads the page; click and fill are how one drives it. Nothing here can
// open a session, switch identity, read the request log or reach the run dir.
const browserFacade = (ctx) => ({
  evaluate: (js) => ctx.browser.ev(js),
  truthy: (js) => ctx.browser.truthy(js),
  click: (selector) => ctx.browser.click(selector),
  fill: (selector, value) => ctx.browser.fill(selector, value),
});

// A run that needs no page (src/dsl/page.mjs) has no browser behind it. A
// capability that declared `page: false` and reaches for one anyway is refused
// in so many words -- not handed a facade whose every answer is "ERROR:".
const noPage = (who) => {
  const refuse = (what) => () => { throw new Refused(`${who} declared page: false, and this run has no page to ${what}`); };
  return { evaluate: refuse("evaluate in"), truthy: refuse("ask"), click: refuse("click on"), fill: refuse("type into") };
};

// A scratch directory of its OWN, inside the store, and every path through
// contained(): an extension writing a temp file cannot reach the checkout, the
// ledger, or another extension's directory, whatever string it builds.
function storageFacade(ctx, who) {
  const dir = () => contained(ctx.store(true), join(ctx.store(true), "scratch", safe(who)));
  return { temp: (name) => within(dir(), name), read: (name) => readAt(ctx, within(dir(), name)), write: (name, text) => writeAt(ctx, within(dir(), name), text) };
}

const within = (dir, name) => contained(dir, join(dir, String(name)));

const safe = (who) => String(who).replace(/[^\w.-]+/g, "-");

// READ-ONLY. A capability that could write a binding could change what a later
// step asks, which is the run rewriting its own question mid-flight.
const bindingsFacade = (run) => ({
  get: (name) => run?.values?.[name],
  names: () => Object.keys(run?.values ?? {}),
});

// One line into this run's log, marked as the extension's and scrubbed on the way
// in -- an extension echoing a connection string into evidence is exactly the
// accident src/scrub.mjs exists for, and an extension cannot be trusted to have
// remembered.
const evidenceFacade = (run, who) => ({
  record: (note) => run?.log?.record({ kind: "capability", by: who, note: scrub(note) }),
});

const logFacade = (ctx, who) => ({
  info: (m) => ctx.print?.say?.(`  · ${who}: ${scrub(m)}`),
  warn: (m) => ctx.warn(`${who}: ${scrub(m)}`),
});

function readAt(ctx, file) {
  const io = ctx.io ?? null;
  return io ? io.read(file) : null;
}

function writeAt(ctx, file, text) {
  const io = ctx.io ?? null;
  return io ? io.write(file, String(text)) : null;
}
