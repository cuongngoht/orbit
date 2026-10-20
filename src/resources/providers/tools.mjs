// CLI tools and runtimes, as resources: the EFFECTIVE list src/tools/effective.mjs
// derives from the plugin's tool catalog, the desired state and the last
// observation. This provider reshapes it and nothing else: it never probes a
// PATH and it never installs anything, so the router it feeds cannot either.
//
// `context.tools()` answers that list.
import { resource } from "../model.mjs";

export const toolProvider = {
  family: "tools",
  list: (context) => (context.tools() ?? []).map(tool),
};

const tool = (t) =>
  resource("tool", { id: t.id, source: t.source ?? "none", ownership: "plugin", enabled: t.enabled, runtimeReady: t.status === "ready", available: t.available, state: t.state, summary: t.summary || t.name, provides: t.provides, detail: { name: t.name, version: t.version, status: t.status } });
