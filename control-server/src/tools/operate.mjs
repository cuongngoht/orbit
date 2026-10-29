// What a person can DO to a CLI tool from Orbit Control: look again, install it
// privately, or update a private install to the version the catalog now pins.
//
//   refresh   detect this one tool again and keep the observation
//   install   detected afresh first, then only when it is NOT usable from any
//             source -- an existing
//             installation is reused, never shadowed by a second one -- and only
//             by an installer that can serve this platform. Writes the receipt
//             (src/tools/install.mjs), marks it desired, and detects it again
//   update    only a Orbit-managed install older than the catalog's pin; the new
//             version goes beside the old one, which is left where it was
//
// All three are POSTs behind the mutation token. Nothing here is ever reached
// from the prompt router: a missing tool there is a line in a decision.
import { detectTool, installContext, installTool, toolCatalogAt, withTool } from "../core.mjs";
import { conflict, guarded } from "../errors.mjs";
import { detectionOf, entryOf, toolOf, toolState } from "./view.mjs";

export function refreshTool(ctx, id) {
  const entry = entryOf(ctx, id);
  const state = toolState(ctx);
  const found = detectTool(entry, detectionOf(ctx, state));
  return (state.change("observed", (doc) => withTool({ ...doc, observedAt: ctx.world.io.now() }, id, found)), toolOf(ctx, id));
}

export async function installOne(ctx, id, update = false) {
  const entry = entryOf(ctx, id);
  admissible(refreshTool(ctx, id), update);
  const state = toolState(ctx);
  const receipt = await guarded("TOOL_INSTALL_FAILED", () => installTool(entry, installationOf(ctx, state)));
  return settled(ctx, state, entry, receipt);
}

// What an install runs with: detection's own context, the install io and installers, and -- for an install that builds
// on another tool (a `python-lock`'s interpreter) -- the catalog to find it in, the Process port and the lock reader.
const installationOf = (ctx, state) => installContext({ ...detectionOf(ctx, state), catalog: toolCatalogAt(ctx.world.pluginRoot, ctx.world.io), process: ctx.world.process, lockFile: ctx.world.lockFile, io: ctx.world.installIo, installers: ctx.world.installers, platform: ctx.world.platform, arch: ctx.world.arch });

function admissible(tool, update) {
  if (update && !tool.update) throw conflict("TOOL_UP_TO_DATE", `${tool.name} has no Orbit-managed install older than ${tool.install.version ?? "the pinned version"}; nothing to update`);
  if (!update && tool.status === "ready") throw conflict("TOOL_ALREADY_AVAILABLE", `${tool.name} is already usable here (${tool.source}${tool.version ? ` ${tool.version}` : ""}); nothing was installed`);
}

function settled(ctx, state, entry, receipt) {
  state.change("desired", (doc) => withTool(doc, entry.id, { enabled: true, installStrategy: "orbit-managed", updatedAt: ctx.world.io.now() }));
  ctx.log(`${receipt.reused ? "reused" : "installed"} ${entry.id} ${receipt.version} for Orbit (${receipt.platform}-${receipt.arch})`);
  return { receipt: { tool: receipt.tool, version: receipt.version, platform: receipt.platform, arch: receipt.arch, installedAt: receipt.installedAt, source: receipt.source, checksum: receipt.checksum, reused: receipt.reused }, tool: refreshTool(ctx, entry.id) };
}
