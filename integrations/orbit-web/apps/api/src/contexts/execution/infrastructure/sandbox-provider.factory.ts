// WHICH SANDBOX PROVIDER this Orbit Web runs employees on, from its configuration (ORBIT_WEB_SANDBOX): the container
// provider -- the allocator, over the control network -- in every compose file; the process provider for a development
// run without one (never isolated, never a shell). A configuration that is not valid leaves none: employees are hired
// and their work waits, and the log says why.
import { Logger } from "@nestjs/common";
import type { AppConfig } from "../../../config/config.js";
import { loadSandboxConfig } from "../../../config/sandbox-config.js";
import type { ProcessPort } from "../../../infra/process/process.port.js";
import type { SandboxProvider } from "../application/sandbox.port.js";
import { containerProviderFrom } from "./sandbox/container-provider.js";
import { ProcessSandboxProvider } from "./sandbox/process-provider.js";

export async function sandboxProviderOf(config: AppConfig, readInput: (storePath: string) => Promise<Buffer>, process: ProcessPort): Promise<SandboxProvider | null> {
  try {
    const sandbox = loadSandboxConfig(config.sourceEnv);
    if (sandbox.provider === "container") return await containerProviderFrom(sandbox, { databaseUrl: config.database.url, readInput });
    return new ProcessSandboxProvider({ dataRoot: config.data.root, process, readInput });
  } catch (err) {
    new Logger("Sandbox").error(`No sandbox provider: ${err instanceof Error ? err.message : String(err)}. Employees are hired, and their work waits.`);
    return null;
  }
}
