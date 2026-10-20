#!/usr/bin/env node
// PROJECT INTELLIGENCE: which technologies this project declares, what the code
// actually uses each one FOR, how it is wired -- and, for a task, whether an
// executable capability should be reused or built.
//
//   node intelligence.mjs ensure [--for="…"] [--dry]  decide, say why, read only what moved
//   node intelligence.mjs scan [--dry]                 re-read everything, whatever the snapshot says
//   node intelligence.mjs facts [<kind>]               the index: ecosystem · manifest · technology ·
//                                                       usage · wiring · integration
//   node intelligence.mjs why <fact-id | technology>   one fact's evidence, or one technology's ladder
//   node intelligence.mjs ecosystems                   what each checkout is built with, and targets
//   node intelligence.mjs dependencies [--unmatched]   every declared package, recognised or not
//   node intelligence.mjs technologies [<id>]          declared · used · configured · used-for · pattern
//   node intelligence.mjs integrations                 one row per system AND operation, and its technology
//   node intelligence.mjs wiring                       what the composition roots register, traced to what it uses
//   node intelligence.mjs resolve <intent…> [--json]   reuse · build · unknown · blocked, with every step
//   node intelligence.mjs propose [--dry]              hand engineering memory what the facts support —
//                                                       as observed candidates, through its own door
//   node intelligence.mjs descriptors                  what this engine recognises, and your own that
//                                                       loaded or were refused
//   node intelligence.mjs where                        where the snapshot is kept, and your descriptors room
//
// MEMORY FIRST. `ensure` re-reads the manifests only when one moved, appeared
// or went away, and source only in the directories that moved. Declared is not
// used, used is not configured, and a repeated pattern is a candidate — the
// views print which rung each technology reached and what they could not tell.
//
// This file is the one COMPOSITION ROOT: the built-in ecosystem adapters, the
// .NET pack (skills/orbit-dotnet), a project's own descriptors
// from the store, the capabilities its extensions register, and engineering
// memory's untrusted door are bound HERE, so nothing under src/intelligence/
// names an ecosystem, a product, or another subsystem's store.
//
// Exit 0 = done · 2 = REFUSED (bad usage, an unknown id) · 3 = BLOCKED (no
// readable checkout, nowhere to keep a snapshot). Never 1: this asks the
// product nothing, so it can never find the product wrong.
import { taskArguments } from "../src/process/task-input.mjs";
import { readFileSync as readTaskStdin } from "node:fs";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Blocked, EXIT, Refused } from "../src/run/errors.mjs";
import { COMMANDS, runIntelligence } from "../src/intelligence/index.mjs";
import { intelligenceContext } from "../src/intelligence/context.mjs";
import { createIntelligenceRegistry } from "../src/intelligence/registry.mjs";
import { builtinEcosystems } from "../src/ecosystems/builtin.mjs";
import { registerDotnetPack } from "../skills/orbit-dotnet/pack.mjs";
import { createContext } from "../src/run/context.mjs";
import { withExtensions } from "../src/extensions/index.mjs";
import { createSourceTree } from "../src/frontend/composite.mjs";
import { scanRoots } from "../src/architecture/context.mjs";
import { engineeringContext } from "../src/engineering/context.mjs";
import { admitted } from "../src/engineering/observe/index.mjs";
import { routeOf } from "../src/engineering/vocab.mjs";

const [cmd, ...args] = taskArguments(process.argv.slice(2), () => readTaskStdin(0, "utf8"));

const now = () => new Date().toISOString();

async function main() {
  if (!COMMANDS[cmd]) return help();
  try {
    runIntelligence(await ready(), cmd, args);
  } catch (e) {
    stopped(e);
  }
}

// Extensions are loaded only for the command that reasons about capabilities:
// loading them is async and reads the store, and `facts` has no use for them.
async function ready() {
  const base = cmd === "resolve" ? await withExtensions(createContext()) : createContext();
  const registry = registerDotnetPack(createIntelligenceRegistry({ ecosystems: builtinEcosystems() }));
  const ctx = intelligenceContext(base, registry, process.env, { source: createSourceTree(scanRoots(base)) });
  return { ...ctx, now, capabilities: () => base.capabilities.list(), conventions: () => conventionsOf(base), propose: (candidates) => proposed(base, candidates) };
}

// The engineering facts that BIND -- a gate enforces them or a person adopted
// them -- as data for the resolver. Read here, so src/intelligence/ never
// reaches into engineering's store.
const conventionsOf = (base) => engineeringContext(base).eng.all().filter((f) => routeOf(f).binding);

// Engineering memory's untrusted door: judged by its candidate contract,
// reconciled by its ingest. Nothing through here can be adopted or enforced.
function proposed(base, candidates) {
  const eng = { ...engineeringContext(base), now };
  return admitted(eng, candidates, { seenBy: { host: eng.eng.host, at: now(), ...(base.env?.ORBIT_SESSION ? { session: base.env.ORBIT_SESSION } : {}) } });
}

function help() {
  const lines = readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(1);
  const end = lines.findIndex((l) => !l.startsWith("//"));
  console.log(lines.slice(0, end).join("\n"));
}

function stopped(e) {
  if (e instanceof Refused) return exitWith("REFUSED", e.message);
  if (e instanceof Blocked) return exitWith("BLOCKED", `BLOCKED: ${e.message}`);
  throw e;
}

function exitWith(status, text) {
  console.error(text);
  process.exit(EXIT[status]);
}

main();
