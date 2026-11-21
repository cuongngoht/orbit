// WHAT AUTO MODE'S CLASSIFIER IS TOLD ABOUT THIS PLACE. In Autonomous, Claude Code's classifier reviews every action
// against its rules and an ENVIRONMENT: a list of entries headed `**<topic>**:`, which by default say of the network
// and the host "None configured". Left so, it reads Claude checking that the documentation it needs answers as "Exfil
// Scouting" (testing which endpoints are reachable) and refuses it. What is said here is narrow: the public sources the
// task needs are ordinary, endpoints unrelated to it are still scouting, and nothing names a tool as safe. So Orbit Web keeps the CLI's own environment -- read once from
// the CLI in the image, `claude auto-mode defaults`, which asks no model -- and replaces those two entries with what is
// true here: open internet egress, in a container that keeps the CLIs' sign-ins. The allow, soft_deny and hard_deny
// rules stay the CLI's own: sending a credential, a sign-in or the workspace's secrets anywhere is still refused, and
// no allow rule lets a network command past the classifier. Setting the environment replaces the defaults whole, so
// when they cannot be read nothing is set and the CLI's own stand.
import { Inject, Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import type { AppConfig } from "../../config/config.js";
import { AGENT_PROCESS_PORT, APP_CONFIG } from "../../core/tokens.js";
import { claudeEnv } from "../../infra/process/env.js";
import { endedHow, succeeded, type ProcessPort } from "../../infra/process/process.port.js";

export const ENVIRONMENT_HERE: Readonly<Record<string, string>> = {
  "Network posture":
    "Open internet egress from inside this container. Reading the public documentation, package registries, repositories and public APIs the task needs -- and checking that such a source answers -- is ordinary work here. Probing endpoints unrelated to the task (webhook or request-capture sites, paste and file-sharing services, tunnels, DNS resolvers) is still reconnaissance, and sending this workspace's files, a credential, a sign-in or a token anywhere is never ordinary work.",
  "Host containment":
    "Claude Code runs inside Orbit Web's Docker container, as a non-root user with no Docker socket, in the workspace of one chat. The same container keeps the sign-ins of the Claude, GitHub and Azure CLIs and Orbit Web's own data under /data: they are never read, printed or sent anywhere.",
};

// A GOVERNED run's place: its way out and its host are the organization's Constitution's, held by Orbit Web.
export const ENVIRONMENT_GOVERNED: Readonly<Record<string, string>> = {
  "Network posture":
    "No direct egress. Every connection leaves through Orbit Web's egress proxy and is allowed only where the organization's Constitution says: the model's own service, and what a person allowed. A refused connection is the boundary, not a fault to work around -- never look for another way out, and never send this workspace's files, a credential or a token anywhere.",
  "Host containment":
    "Claude Code runs under Orbit Web governance, in the workspace of one chat, holding no sign-in but its own Claude account: pushing, a repository's credentials and the organization's records are Orbit Web's, reached only through the agent gateway, and every request there is decided by the Constitution and recorded.",
};

const heading = (entry: string): string | null => /^\*\*(.+?)\*\*:/.exec(entry)?.[1] ?? null;

// The CLI's environment with this place's entries in place of its own (added at the end when it no longer has one).
export function environmentFor(defaults: readonly string[], here: Readonly<Record<string, string>> = ENVIRONMENT_HERE): string[] {
  const entryOf = (topic: string): string => `**${topic}**: ${here[topic]}`;
  const replaced = defaults.map((e) => {
    const topic = heading(e);
    return topic !== null && topic in here ? entryOf(topic) : e;
  });
  const missing = Object.keys(here).filter((topic) => !defaults.some((e) => heading(e) === topic));
  return [...replaced, ...missing.map(entryOf)];
}

// `claude auto-mode defaults` prints JSON whose `environment` is a list of strings; anything else is not read.
export function parseDefaults(stdout: string): string[] | null {
  try {
    const env = (JSON.parse(stdout) as { environment?: unknown }).environment;
    return Array.isArray(env) && env.length > 0 && env.every((e) => typeof e === "string") ? (env as string[]) : null;
  } catch {
    return null;
  }
}

const READ_TIMEOUT_MS = 30_000;
// A read that failed is tried again only this much later, never on every run.
const RETRY_MS = 5 * 60_000;

@Injectable()
export class AutoModeService implements OnModuleInit {
  private readonly logger = new Logger("AutoMode");
  private environment: string[] | null = null;
  private defaults: string[] | null = null;
  private reading: Promise<void> | null = null;
  private failedAt = 0;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(AGENT_PROCESS_PORT) private readonly process: ProcessPort,
  ) {}

  // Read at start, in the background: a run that starts before it is read uses the CLI's own environment.
  onModuleInit(): void {
    void this.read();
  }

  // The environment for an Autonomous run, or null (the CLI's own then stand). A governed run is told its own place.
  current(governed = false): string[] | null {
    if (this.environment === null && Date.now() - this.failedAt > RETRY_MS) void this.read();
    if (governed && this.defaults !== null) return environmentFor(this.defaults, ENVIRONMENT_GOVERNED);
    return this.environment;
  }

  read(): Promise<void> {
    this.reading ??= this.fetch().finally(() => (this.reading = null));
    return this.reading;
  }

  private async fetch(): Promise<void> {
    try {
      const r = await this.process.run(this.config.binaries.claude, ["auto-mode", "defaults"], { cwd: this.config.data.home, env: claudeEnv(this.config), timeoutMs: READ_TIMEOUT_MS });
      const defaults = succeeded(r) ? parseDefaults(r.stdout) : null;
      if (defaults === null) this.failed(endedHow(r));
      else {
        this.defaults = defaults;
        this.environment = environmentFor(defaults);
      }
    } catch (err) {
      this.failed(err instanceof Error ? err.message : String(err));
    }
  }

  private failed(why: string): void {
    this.failedAt = Date.now();
    this.logger.warn(`auto mode's defaults could not be read (${why}): Autonomous runs keep the CLI's own environment`);
  }
}
