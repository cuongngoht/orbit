// Orbit Web's entry point: read the configuration, make the data directories, mark runs a restart cut short, and
// listen.
import { Logger } from "@nestjs/common";
import { createApp } from "./bootstrap.js";
import { ConfigError, loadConfig } from "./config/config.js";
import { ensureDataDirs } from "./config/data-dirs.js";

async function main(): Promise<void> {
  // Everything Orbit Web and its children create (the database, a workspace, a CLI's sign-in) is private to its user.
  process.umask(0o077);
  const config = loadConfig(process.env);
  ensureDataDirs(config.data);
  const app = await createApp(config);
  await app.listen(config.port, config.bind);
  new Logger("OrbitWeb").log(`listening on http://${config.bind}:${config.port}`);
}

main().catch((err: unknown) => {
  const logger = new Logger("OrbitWeb");
  logger.error(err instanceof ConfigError ? `configuration refused: ${err.message}` : err instanceof Error ? (err.stack ?? err.message) : String(err));
  process.exit(1);
});
