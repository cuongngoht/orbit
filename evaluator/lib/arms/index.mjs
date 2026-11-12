// THE ARMS: what is under test. Every arm runs through the same entry, container, network, limits, prompt and grader;
// an arm says only what program runs as the agent, what it is handed besides the task (a plugin, a control's patch),
// which credential NAMES it needs, and whether what it does costs money. A new arm (mini-SWE-agent, later) is one new
// file registered here, not a change to the runner.
//
//   ARM_KINDS            armOf(id, def) -> arm      arm: { id, kind, def, charges, credentialNames, needsNetwork,
//                                                          validate(), freeze(ctx), files(ctx), argv(ctx), control }
import { claudeArm, orbitArm } from "./claude.mjs";
import { scriptedArm } from "./scripted.mjs";

export const ARM_KINDS = { claude: claudeArm, "claude+orbit": orbitArm, scripted: scriptedArm };

export function armOf(id, def) {
  const make = ARM_KINDS[def?.kind];
  if (!make) throw new Error(`arm ${id}: kind must be one of ${Object.keys(ARM_KINDS).join(", ")}`);
  const arm = make(id, def);
  const problems = arm.validate();
  if (problems.length) throw new Error(`arm ${id}: ${problems.join("; ")}`);
  return arm;
}
