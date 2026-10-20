// The effects a person can ask for on a managed server: test it, install its
// runtime, delete its runtime -- each a POST or DELETE behind the token, each
// bounded, and none a way to run an arbitrary command:
//
//   test      one handshake (src/mcp/probe.mjs, BASE_ENV) with the managed
//             definition, its secrets read from this process's environment at
//             that moment. The verdict is KEPT under the managed key -- the only
//             way a managed server becomes `connected`. An UNSAVED definition
//             (POST /mcp/test) is tested the same way and its verdict only returned
//   install   the catalog row's installer strategy (src/mcp/install.mjs):
//             remote-http installs nothing; archive stages, verifies the pinned
//             SHA-256, promotes, and writes the receipt LAST
//   runtime   DELETE the files Orbit installed for one server, and its receipts --
//             a second, explicit act, only ever inside <store>/runtimes/mcp
import { installMcp, keyOf, managedProblems, managedRecord, mcpCatalogAt, mcpInvokeContext, mcpStateOf, probeManaged, recordCheck, removeRuntime } from "../core.mjs";
import { conflict, guarded, invalid } from "../errors.mjs";
import { entryOf, manageCtx, publicMcp } from "./view.mjs";

export async function testManaged(ctx, id) {
  entryOf(ctx, id);
  const invoke = mcpInvokeContext(ctx.world);
  const check = await guarded("MCP_TEST_FAILED", () => probeManaged(invoke.records[id], invoke.connect, ctx.world.managedProbe));
  recordCheck(manageCtx(ctx), keyOf("orbit-managed", id), check);
  return { server: publicMcp(entryOf(ctx, id)), check: shown(check) };
}

export async function testUnsaved(ctx, body) {
  const definition = body?.definition;
  const problems = managedProblems(definition);
  if (problems.length) throw invalid("INVALID_MCP_DEFINITION", `the server was not tested: ${problems.length} problem${problems.length > 1 ? "s" : ""}, listed in details`, problems);
  if (definition.commandRef) throw invalid("INVALID_MCP_DEFINITION", "a Orbit-managed runtime comes from a catalog row; test it once it is added and installed");
  return { check: shown(await guarded("MCP_TEST_FAILED", () => probeManaged(managedRecord(definition, { origin: "custom", at: ctx.world.io.now() }), mcpInvokeContext(ctx.world).connect, ctx.world.managedProbe))) };
}

export async function installManaged(ctx, id) {
  const entry = entryOf(ctx, id);
  if (entry.runtime?.kind !== "managed") throw conflict("MCP_NOTHING_TO_INSTALL", entry.runtime?.kind === "remote" ? `${entry.name} is reached over HTTP; there is nothing to install` : `${entry.name} runs a command this machine already has; Orbit installs nothing for it`);
  const row = mcpCatalogAt(ctx.world.pluginRoot, ctx.world.io).find((e) => e.id === entry.catalog);
  const receipt = await guarded("MCP_INSTALL_FAILED", () => installMcp(row ?? { id, name: entry.name, install: {} }, { installers: ctx.world.mcpInstallers, platform: ctx.world.platform, arch: ctx.world.arch, rooms: ctx.world.rooms, state: mcpStateOf(ctx.world), io: ctx.world.installIo, exists: (p) => ctx.world.io.exists(p), now: () => ctx.world.io.now() }));
  return (ctx.log(`${receipt?.reused ? "reused" : "installed"} the ${id} MCP runtime ${receipt?.version ?? ""} for Orbit`), { receipt: receiptShown(receipt), server: publicMcp(entryOf(ctx, id)) });
}

export function deleteRuntime(ctx, id) {
  if (typeof id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(id)) throw invalid("INVALID_MCP_ID", "an MCP server id is letters, digits and . _ - only");
  const done = removeRuntime(id, { rooms: ctx.world.rooms, state: mcpStateOf(ctx.world), io: ctx.world.io });
  ctx.log(`deleted the ${id} MCP runtime files from the machine store`);
  return { id, ...done };
}

const shown = (check) => ({ status: check.status, checkedAt: check.checkedAt, reason: check.reason ?? null, toolCount: check.tools?.length ?? null, tools: check.tools ?? null });

// A receipt as a page may see it: never a path.
const receiptShown = (r) => (r ? { mcp: r.mcp, version: r.version, platform: r.platform, arch: r.arch, installedAt: r.installedAt, source: r.source, checksum: r.checksum, reused: r.reused } : null);
