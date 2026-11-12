// THE ARMS: what is under test. Every arm runs through the same entry, container, network, limits, prompt and grader;
// an arm says only what program runs as the agent, what it is handed besides the task (a plugin, a control's patch),
// which credential NAMES it needs, and whether what it does costs money. A new arm is one new file registered here.
// An arm whose agent runs on the HOST (`runsOn: "host"`, mini-SWE-agent) says how in `host(ctx)`; its container gets no
// network and no credential, and the runner holds it open while the host's agent acts in it.
//
//   ARM_KINDS            armOf(id, def) -> arm      arm: { id, kind, def, charges, credentialNames, needsNetwork,
//                                                          validate(), freeze(ctx), files(ctx), argv(ctx), control,
//                                                          runsOn, containerCredentialNames?, homeFiles?, host(ctx)? }
import { claudeArm, orbitArm } from "./claude.mjs";
import { miniArm, miniOrbitArm } from "./mini.mjs";
import { scriptedArm } from "./scripted.mjs";

export const ARM_KINDS = { claude: claudeArm, "claude+orbit": orbitArm, mini: miniArm, "mini+orbit": miniOrbitArm, scripted: scriptedArm };

export function armOf(id, def) {
  const make = ARM_KINDS[def?.kind];
  if (!make) throw new Error(`arm ${id}: kind must be one of ${Object.keys(ARM_KINDS).join(", ")}`);
  const arm = make(id, def);
  const problems = arm.validate();
  if (problems.length) throw new Error(`arm ${id}: ${problems.join("; ")}`);
  return arm;
}
