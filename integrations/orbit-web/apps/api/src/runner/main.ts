// The runner's entry point: the agent container's (docker/compose.governed.yaml), and an employee attempt's model plane
// (started by the allocator). It runs the runner and nothing else -- no API, no database, no sign-in but the
// configuration the CLI it starts needs.
//
//   node /opt/orbit-web/apps/api/dist/runner/main.js      (ORBIT_WEB_RUNNER_PORT, default 7070)
//
// A model plane's runner is given ORBIT_WEB_RUNNER_TOKEN (its attempt's own: it answers no connection that does not
// name it first) and ORBIT_WEB_RUNNER_PASS_ENV (the names of its own variables every program it starts is given).
import { startRunner } from "./server.js";

process.umask(0o077);
const port = Number(process.env.ORBIT_WEB_RUNNER_PORT ?? "7070");
const token = process.env.ORBIT_WEB_RUNNER_TOKEN && process.env.ORBIT_WEB_RUNNER_TOKEN.length > 0 ? process.env.ORBIT_WEB_RUNNER_TOKEN : null;
const baseEnv = Object.fromEntries(
  (process.env.ORBIT_WEB_RUNNER_PASS_ENV ?? "")
    .split(",")
    .map((n) => n.trim())
    .filter((n) => n.length > 0 && !n.startsWith("ORBIT_WEB_RUNNER_") && typeof process.env[n] === "string")
    .map((n) => [n, process.env[n] as string]),
);
// Nothing this runner starts inherits the token (programs get only the frame's environment and baseEnv anyway).
delete process.env.ORBIT_WEB_RUNNER_TOKEN;
startRunner(port, "0.0.0.0", { token, baseEnv })
  .then(() => process.stdout.write(`orbit-web runner listening on ${port}${token === null ? "" : " (one attempt's token required)"}\n`))
  .catch((err: unknown) => {
    process.stderr.write(`orbit-web runner could not listen on ${port}: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
