// The host's own MCP servers, from Orbit Control: OBSERVE ONLY.
//
//   refresh   re-read the host's configuration and save it as the external
//             snapshot the prompt router reads -- nothing is connected to
//   test      one handshake with a host server AS THE HOST CONFIGURED IT (the
//             adapter reads its secrets and never returns them); the verdict is
//             kept under the external key, so it can never be read as a managed
//             server's health
//
// Nothing here adds, edits or removes anything in a host's configuration, and
// nothing makes a host server eligible for routing: to use one, a person adds
// it to Orbit, which is a managed resource of its own.
import { keyOf, observeMcp, recordCheck } from "../core.mjs";
import { guarded } from "../errors.mjs";
import { listOwned } from "./read.mjs";
import { entryOf, manageCtx, publicMcp } from "./view.mjs";

export function refreshExternal(ctx) {
  observeMcp(ctx.world);
  return listOwned(ctx, "external");
}

export async function testExternal(ctx, id) {
  const entry = entryOf(ctx, id, "external");
  const check = await guarded("MCP_TEST_FAILED", () => ctx.world.host.testServer(entry.id));
  recordCheck(manageCtx(ctx), keyOf("external", entry.id), check);
  return { server: publicMcp(entryOf(ctx, id, "external")), check: { status: check.status, checkedAt: check.checkedAt, reason: check.reason ?? null, toolCount: check.tools?.length ?? null, tools: check.tools ?? null } };
}
