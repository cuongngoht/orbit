// Can THIS project verify that layer at all?
//
// The engine has a verb for every layer in LAYERS, which is not the same as a
// machine being able to run it: reading the database needs a command the project
// declares, and a project that declares none cannot be held to an sql verdict.
// "Do not force every application to have SQL" is a rule about the engine as much as about
// a plan -- so a missing tool becomes a capability gap, reported, never a finding
// against the product and never a reason to quietly drop the layer.
import { LAYERS } from "../dsl/verbs.mjs";

// The layer whose verb needs a tool the project supplies, and what supplies it.
// One row; a second layer with a tool is a second row.
const TOOLED = { sql: { needs: "sql.command", has: (config) => Boolean(config?.sql?.command?.length) } };

export function capabilitiesOf(config) {
  const rows = LAYERS.map((layer) => [layer, available(layer, config)]);
  return Object.fromEntries(rows);
}

function available(layer, config) {
  const tool = TOOLED[layer];
  if (!tool) return { can: true, because: "" };
  return tool.has(config) ? { can: true, because: "" } : { can: false, because: `this project declares no ${tool.needs}, so nothing here can read that layer` };
}

export const canVerify = (caps, layer) => caps?.[layer]?.can !== false;
