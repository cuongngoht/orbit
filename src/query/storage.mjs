// WHERE everything is, asked once instead of told nine times.
//
// `engineRoot` is the odd one out and the reason this comment exists. Every
// other field is a place the engine DECIDED; that one is the place the engine
// IS, and it is here because nothing else can answer it after bootstrap.
//
// It cannot replace ${CLAUDE_PLUGIN_ROOT} in a playbook, and the attempt is
// circular: running `query storage` needs the engine root, so a command that
// prints the engine root is a command you cannot invoke without already having
// it. The env var is the only thing that exists BEFORE anything runs.
//
// What it does replace is every LATER telling. A subagent, a hook, a CI job or
// a launcher that already has one path into the engine gets the rest from one
// call, instead of each playbook restating the same sentence in its own words --
// which is what nine of them were doing, in five different wordings.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Two levels up from src/query/: the package root, found from the module's own
// location rather than from an environment variable, so it is right in a clone,
// in an installed plugin and inside a test alike.
const ENGINE_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

export function storage(ctx, args) {
  const paths = storagePaths(ctx);
  if (args.includes("--json")) return console.log(JSON.stringify(paths, null, 2));
  for (const [key, value] of Object.entries(paths)) console.log(`${key}: ${value}`);
}

// `dataHome` says where the test data lives (1.8.9, src/project/data-home.mjs): `store`, `checkout`, or `loose` for a
// ui-tests/ directory named on purpose (ORBIT_UI_TESTS, or one found walking up). `checkoutDataRoot` is a checkout's
// committed ui-tests/ that is NOT what is read, because its store is the home -- said so a person is never surprised
// by edits that change nothing.
export function storagePaths(ctx) {
  const root = typeof ctx.store === "function" ? ctx.store() : ctx.store.root;
  const p = ctx.project;
  return { layout: p.layout, dataHome: p.dataHome, engineRoot: ENGINE_ROOT, repoRoot: p.root, storeRoot: root, dataRoot: p.uiTests, graphDir: p.graphDir, screensDir: p.screensDir, schemaDir: p.schemaDir, draftsDir: join(root, "drafts", "cases"), scratchDir: join(root, "scratch"), evidenceDir: join(root, "evidence"), runtimeDir: p.runtime ?? null, reportsDir: ctx.config.reports };
}
