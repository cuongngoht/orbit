// THE ALLOCATOR'S PROCESS (docker/compose.yaml, service orbit-allocator): the only holder of the container runtime's
// socket. It reads the sandbox configuration and the shared secret, probes what this host can enforce (and says so),
// then serves the typed operations to Orbit Web on the private control network.
//
//   node /opt/orbit-web/apps/api/dist/allocator/main.js
import { loadSandboxConfig } from "../config/sandbox-config.js";
import { readSecret } from "../contexts/execution/infrastructure/sandbox/allocator-protocol.js";
import { Allocator } from "./allocator.js";
import { allocatorServer } from "./server.js";

const log = (line: string): void => {
  process.stdout.write(`${new Date().toISOString()} orbit-allocator ${line}\n`);
};

function main(): void {
  const config = loadSandboxConfig(process.env);
  const secret = readSecret(config.allocatorServer.secretFile);
  const allocator = new Allocator({ config, secret });
  const server = allocatorServer(allocator, secret, log);
  server.listen(config.allocatorServer.port, config.allocatorServer.bind, () => log(`listening on ${config.allocatorServer.bind}:${config.allocatorServer.port}`));
  // Runtime security (ADR 0063): what the previous process protected is restored for the watchdog to prove again, then
  // the ingest, watchdog and canary loops run in this process.
  allocator.security
    .restore()
    .then((kept) => {
      allocator.security.start();
      log(`runtime security: backend ${config.runtimeSecurity.backend}, floor ${config.runtimeSecurity.floor}, ${kept} attempt(s) restored for re-proof`);
    })
    .catch((err: unknown) => log(`runtime security could not start: ${err instanceof Error ? err.message : String(err)}`));
  allocator
    .probe(true)
    .then((caps) => log(`probe: runtime ${caps.runtime.reachable ? caps.runtime.detail : "UNREACHABLE"}; limits cpu ${caps.limits.cpu}, memory ${caps.limits.memory}, pids ${caps.limits.pids}; storage ${caps.storage.mechanism} per area ${caps.storage.perArea}, host ${caps.storage.hostProtection}; shell possible: ${caps.shellPossible}. ${caps.storage.evidence}`))
    .catch((err: unknown) => log(`probe failed: ${err instanceof Error ? err.message : String(err)}`));
  const stop = () => {
    log("stopping");
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5_000).unref();
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
}

// `destroy-storage --confirm=<the workforce volume's name>`: the employees' storage removed for good -- the storage
// helper, the workforce volume, the pool's store and its loop device. Every desk with it.
async function destroyStorage(): Promise<void> {
  const config = loadSandboxConfig(process.env);
  const confirm = process.argv.find((a) => a.startsWith("--confirm="))?.slice("--confirm=".length);
  if (confirm !== config.names.workforceVolume) {
    process.stderr.write(`this removes every employee's desk, cache and workspace: run it with --confirm=${config.names.workforceVolume}\n`);
    process.exit(2);
  }
  const allocator = new Allocator({ config, secret: "-".repeat(32) });
  await allocator.storage.destroy();
  log(`the workforce storage (${config.names.workforceVolume}, ${config.names.workforceStoreVolume}) is removed`);
}

if (process.argv[2] === "destroy-storage") {
  destroyStorage().catch((err: unknown) => {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
} else {
  try {
    main();
  } catch (err) {
    process.stderr.write(`orbit-allocator could not start: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  }
}
