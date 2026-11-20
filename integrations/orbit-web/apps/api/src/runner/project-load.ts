// A WORKSPACE'S PROJECT, read where the agent runs (governed deployment): its .claude skills, commands, agents and
// plugins, and the session's project plugin built from them -- the same functions the single deployment calls in
// process (modules/project), run here so that the control plane never reads or writes a directory the agent can write.
// It prints one JSON object; what it says about the repository is the repository's (untrusted) content, bounded.
//
//   node project-load.js <workspace> <plugin-target> <repository|""> <build: 0|1>
import { readRepository } from "../modules/project/inventory.js";
import { buildProjectPlugin } from "../modules/project/project-plugin.js";

const [workspace, target, repository, build] = process.argv.slice(2);
if (!workspace || !target) {
  process.stderr.write("usage: project-load.js <workspace> <plugin-target> <repository> <build>\n");
  process.exit(2);
}
try {
  const readout = readRepository(workspace);
  const built = build === "1" ? buildProjectPlugin(workspace, target, repository || null) : null;
  process.stdout.write(`${JSON.stringify({ readout, built })}\n`);
} catch (err) {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
}
