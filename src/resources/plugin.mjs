// Which skills and agents this plugin ships, what each one is FOR, and the
// engine's own built-in providers.
//
// What ships is read off the plugin's own tree the way a host discovers it --
// every skills/<name>/ holding a SKILL.md, every agents/<name>.md -- so a skill
// deleted in Orbit Control is gone here too, and there is no list to keep in
// step. What each is for is catalog/components.json: routing data, one row per
// component, which test/resources.test.mjs holds against the tree. A component
// with no row is still listed; it simply provides nothing a router could match.
//
// `builtins` in the same catalog are what the ENGINE answers without any skill,
// server or tool: data, so no file under src/ names one.
import { join } from "node:path";
import { catalogFile, readCatalog } from "../catalog.mjs";

// A name that could be a component's: no dot, so `.hidden/` and `..` are not --
// the same rule Orbit Control lists skills by.
const NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

export function pluginComponents(pluginRoot, io) {
  const rows = routingRows(pluginRoot, io);
  const skills = io.list(join(pluginRoot, "skills")).filter((d) => NAME.test(d) && io.exists(join(pluginRoot, "skills", d, "SKILL.md")));
  const agents = io.list(join(pluginRoot, "agents")).filter((f) => f.endsWith(".md")).map((f) => f.slice(0, -3)).filter((n) => NAME.test(n));
  return [...skills.map((name) => component("skill", name, rows.skills)), ...agents.map((name) => component("agent", name, rows.agents))];
}

const component = (kind, name, rows) => ({ kind, name, routing: rows?.[name] ?? {} });

export const pluginBuiltins = (pluginRoot, io) => Object.fromEntries(Object.entries(routingRows(pluginRoot, io).builtins ?? {}).filter(([id, row]) => NAME.test(id) && row && typeof row === "object"));

// A catalog that cannot be read leaves every component with no routing, and the
// components themselves still listed: what ships is a fact about the tree.
function routingRows(pluginRoot, io) {
  try { return readCatalog(io, catalogFile(pluginRoot, "components")); }
  catch { return {}; }
}
