// The .NET intelligence PACK: what this plugin ships that knows real products.
//
// It lives in skills/, not src/, for the reason every concrete tool does
// (AGENTS.md): the engine holds no product knowledge, and a catalog that
// recognises a Graph package or an analyser that reads a ClientContext is
// product knowledge by definition. The engine's core registers nothing; the
// composition root registers this pack, and a project's own descriptors after
// it. Everything here reaches the core only as REGISTRATIONS -- descriptors as
// data (catalog.json), analysers as pure functions over one file -- which is
// exactly the door a Java pack would come through.
import { readFileSync } from "node:fs";
import { csom } from "./analyzers/csom.mjs";
import { adonet, dapper, efcore } from "./analyzers/data.mjs";
import { di } from "./analyzers/di.mjs";
import { graph } from "./analyzers/graph.mjs";
import { messaging } from "./analyzers/messaging.mjs";
import { redis } from "./analyzers/redis.mjs";

export const PACK = "orbit-dotnet-intelligence";

export const DESCRIPTORS = JSON.parse(readFileSync(new URL("./catalog.json", import.meta.url), "utf8"));

export const ANALYZERS = [graph, csom, efcore, dapper, adonet, redis, ...messaging, di];

export function registerDotnetPack(registry) {
  for (const d of DESCRIPTORS) registry.descriptors.register(d, PACK);
  for (const a of ANALYZERS) registry.analyzers.register(a, PACK);
  return registry;
}
