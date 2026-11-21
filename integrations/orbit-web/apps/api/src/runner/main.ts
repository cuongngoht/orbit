// The agent container's entry point (docker/compose.governed.yaml): the runner, and nothing else -- no API, no
// database, no sign-in but the Claude account's own configuration, which the agent's Claude Code needs.
//
//   node /opt/orbit-web/apps/api/dist/runner/main.js      (ORBIT_WEB_RUNNER_PORT, default 7070)
import { startRunner } from "./server.js";

process.umask(0o077);
const port = Number(process.env.ORBIT_WEB_RUNNER_PORT ?? "7070");
startRunner(port)
  .then(() => process.stdout.write(`orbit-web runner listening on ${port}\n`))
  .catch((err: unknown) => {
    process.stderr.write(`orbit-web runner could not listen on ${port}: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
