// The TOOLS a sign-in needs, as the port the adapter asks (skills/orbit-report/auth/azure-cli.mjs): `ensure` -- how to
// start one of the rows the strategy names, fetching a private copy when nothing usable is here -- and `find`, which
// only looks. Each call is made over the machine as it is NOW (receipts, the PATH), so an install made a moment ago
// is seen by the next question.
//
// Bound here and not in src/ because it is a composition: the real effects (src/tools/real.mjs), the two installers
// a private copy uses, and the catalog the plugin ships. Binding starts nothing.
import { catalogFile, readCatalog } from "../../../src/catalog.mjs";
import { archiveInstaller } from "../../../src/tools/archive.mjs";
import { toolCatalog } from "../../../src/tools/catalog.mjs";
import { detectionContext } from "../../../src/tools/context.mjs";
import { ensureOne, findOne } from "../../../src/tools/ensure.mjs";
import { pythonLockInstaller } from "../../../src/tools/pylock.mjs";
import { realInstallIo, realLockFile } from "../../../src/tools/real.mjs";
import { createToolState } from "../../../src/tools/state.mjs";

const INSTALLERS = { [archiveInstaller.strategy]: archiveInstaller, [pythonLockInstaller.strategy]: pythonLockInstaller };

// w: { pluginRoot, env, rooms, io (src/store/io.mjs realIo), process (the Process port), log? }
export function createToolsPort(w) {
  const catalog = toolCatalog(readCatalog(w.io, catalogFile(w.pluginRoot, "tools")));
  return { ensure: (ids) => ensureOne(ids, world(w, catalog)), find: (ids) => findOne(ids, world(w, catalog)) };
}

function world(w, catalog) {
  const state = createToolState(w.rooms, w.io);
  const base = detectionContext({ env: w.env, rooms: w.rooms, receipts: state.receipts(), now: () => new Date().toISOString() });
  return { ...base, catalog, state, io: realInstallIo(w.log), installers: INSTALLERS, process: w.process, lockFile: realLockFile(w.pluginRoot) };
}
