// Capabilities, as resources -- from two lists that are never merged:
//
//   the engine's BUILT-INS   what Orbit itself answers, declared as data in
//                            catalog/components.json (`builtins`): the project
//                            context a developer works from, the checkout the
//                            session already reads. Always there, owned by
//                            `orbit`, and the most trusted provider of what they
//                            provide -- so an enabled MCP server is never chosen
//                            to do what the session can already do itself
//   the PROJECT's own        read off the ONE capability registry
//                            (src/capability/registry.mjs) the runner itself
//                            resolves `call` against, never a second list
//   a PACK's readers         rows a skill's pack ships, already shaped by the pack
//                            (skills/orbit-requirements/bind.mjs): a reader that
//                            reads a work item through a connection PROVIDES what
//                            it reads, and is ready only when the connection is
//                            there. The registry lists them and knows no provider
//
// `context.capabilities()` answers that registry's `list()`. A project with none
// answers [], and one whose extensions failed to load answers whatever did load:
// the loader records refusals and never throws, and this provider is isolated
// by the registry besides.
//
// A project capability PROVIDES its own id -- that is what a case asks it for --
// and whatever else it declared it `provides` (a semantic capability a need can
// name, so the provider behind it can change), and NEEDS every command it declared
// in `tools`, spelled `command:<bin>`, which is how a CLI tool resource says it
// provides one.
import { resource } from "../model.mjs";
import { engineName } from "../../version.mjs";

export const capabilityProvider = {
  family: "capabilities",
  list: (context) => [...Object.entries(context.builtins?.() ?? {}).map(builtin), ...(context.capabilities() ?? []).map(capability), ...packed(context)],
};

// A pack that cannot answer (an unreadable connection store, say) lists nothing of
// its own -- and must not take the built-ins and the project's capabilities down
// with it, which the registry's per-family isolation would otherwise do.
function packed(context) {
  try { return context.packCapabilities?.() ?? []; }
  catch { return []; }
}

const builtinNs = () => engineName() ?? "orbit";

const builtin = ([id, row]) => {
  const ns = builtinNs();
  return resource("capability", { ...row, id, key: `${ns}:${id}`, source: ns, ownership: ns, enabled: true, runtimeReady: true, available: true, state: "ready", detail: { builtin: true, implicit: row.implicit === true, run: typeof row.run === "string" ? row.run : null } });
};

const capability = (c) =>
  resource("capability", { id: c.id, source: c.from ?? "project", ownership: "project", enabled: true, runtimeReady: true, available: true, state: "ready", summary: c.doc, provides: [...new Set([c.id, ...(c.provides ?? [])])], needs: (c.tools ?? []).map((bin) => `command:${bin}`), detail: { apiVersion: c.apiVersion, mutates: c.mutates === true, connection: c.connection ?? null } });
