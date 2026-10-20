// Supported native host protocols, loaded explicitly when a hook names its host.
// The fallback has no `normalize`, so src/lifecycle/event.mjs turns every event
// from a host nobody recognises into no event at all: a safe no-op.
import * as antigravity from "./antigravity.mjs";
import * as claude from "./claude.mjs";

const HOSTS = [claude];

const fallback = {
  name: "unknown",
  isWatched: () => false,
  formatSessionStart: () => null,
  formatPreTool: () => null,
  formatPostTool: () => null,
  formatFailure: () => null,
  formatPromptContext: () => null,
  memoryLocation: () => null,
};

export function resolveHost(input, argv = []) {
  return HOSTS.find((h) => h.matches(input, argv)) ?? fallback;
}

// The native Claude hook shape is recognized; other hosts name their protocol explicitly.
const LOADERS = {
  "claude:1": async () => claude,
  "codex:2": () => import("./codex.mjs"),
  "antigravity:2": () => Promise.resolve(antigravity),
  "grok:2": () => import("./grok.mjs"),
};

export async function resolveHookHost(input, argv = [], hint) {
  const names = [...argv.filter((a) => a.startsWith("--host=")).map((a) => a.slice(7)), ...[hint].filter(Boolean)];
  const protocols = argv.filter((a) => a.startsWith("--protocol=")).map((a) => a.slice(11));
  if (!names.length) return protocols.length ? fallback : resolveHost(input, argv);
  if (new Set(names).size !== 1 || new Set(protocols).size > 1) return fallback;
  return selected(`${names[0]}:${protocols[0] ?? "1"}`);
}

async function selected(key) {
  try { return await LOADERS[key]?.() ?? fallback; }
  catch { return fallback; }
}
