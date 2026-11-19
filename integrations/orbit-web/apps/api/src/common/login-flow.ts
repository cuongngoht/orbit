// ONE SIGN-IN OF AN OFFICIAL CLI, driven as a process: `claude auth login` or `gh auth login --web`. The CLI does
// the whole authentication protocol; this only starts it, reads the URL (and GitHub's one-time code) it prints, hands
// a person's input to its stdin when it asks for one, and stops it on cancel or timeout. Success is never read from
// the CLI's words: after it exits 0, `verify` asks the CLI's own status command.
//
//   idle -> starting -> awaiting_user -> verifying -> connected | failed
//                 \-------------\--------------\--> cancelled | timed_out | failed
import { LOGIN_ACTIVE, type LoginSnapshot, type LoginState } from "@orbit-web/contracts";
import type { ExitInfo, ProcessHandle, ProcessPort } from "../infra/process/process.port.js";
import { redactSecrets } from "../infra/security/redact.js";

export interface LoginFields {
  url?: string | null;
  code?: string | null;
  needsCode?: boolean;
  message?: string | null;
}

export interface LoginDriver {
  file: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  timeoutMs: number;
  // What the output so far says (the whole bounded output, re-read after each chunk: a prompt has no newline).
  read(output: string): LoginFields;
  // Whether the URL (and code) a person needs have both been printed.
  ready(fields: LoginFields): boolean;
  // Asks the CLI's own status command whether the sign-in holds.
  verify(): Promise<{ ok: boolean; message: string | null }>;
  // A one-line reason, from what the CLI printed, when it failed.
  failure(output: string, exit: ExitInfo): string;
}

const OUTPUT_LIMIT = 16 * 1024;

const idle = (): LoginSnapshot => ({ state: "idle", url: null, code: null, needsCode: false, message: null, startedAt: null, updatedAt: new Date().toISOString() });

export class LoginFlow {
  private snapshot: LoginSnapshot = idle();
  private handle: ProcessHandle | null = null;
  private output = "";
  // What the CLI printed after a person's input was handed to it: a second prompt means it was not accepted.
  private afterSubmit: string | null = null;
  private ending: "cancelled" | "timed_out" | null = null;
  private timer: NodeJS.Timeout | null = null;
  private readonly listeners = new Set<(s: LoginSnapshot) => void>();

  constructor(private readonly process: ProcessPort) {}

  current(): LoginSnapshot {
    return { ...this.snapshot };
  }

  active(): boolean {
    return LOGIN_ACTIVE.includes(this.snapshot.state);
  }

  subscribe(listener: (s: LoginSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // Starts a sign-in, or returns the one already under way.
  start(driver: LoginDriver): LoginSnapshot {
    if (this.active()) return this.current();
    this.output = "";
    this.afterSubmit = null;
    this.ending = null;
    this.set({ ...idle(), state: "starting", startedAt: new Date().toISOString() });
    const handle = this.process.spawn(driver.file, driver.args, { cwd: driver.cwd, env: driver.env });
    this.handle = handle;
    handle.onStdout((chunk) => this.heard(driver, chunk));
    handle.onStderr((chunk) => this.heard(driver, chunk));
    handle.onExit((exit) => void this.exited(driver, handle, exit));
    this.timer = setTimeout(() => this.stop("timed_out"), driver.timeoutMs);
    this.timer.unref();
    return this.current();
  }

  // A person's input for the prompt the CLI printed (Claude's code). Written to that process's stdin only.
  submit(text: string): LoginSnapshot {
    if (this.snapshot.state !== "awaiting_user" || !this.snapshot.needsCode || this.handle === null) return this.current();
    this.handle.write(`${text}\n`);
    this.afterSubmit = "";
    this.set({ ...this.snapshot, state: "verifying", message: "Checking the code with the Claude CLI…" });
    return this.current();
  }

  cancel(): LoginSnapshot {
    if (this.active()) this.stop("cancelled");
    return this.current();
  }

  // A sign-out or a status that says connected makes a finished flow's last word stale.
  reset(): void {
    if (!this.active()) this.set(idle());
  }

  private stop(why: "cancelled" | "timed_out"): void {
    if (this.handle === null) return;
    this.ending = why;
    const handle = this.handle;
    handle.kill("SIGTERM");
    setTimeout(() => handle.kill("SIGKILL"), 3_000).unref();
  }

  private heard(driver: LoginDriver, chunk: string): void {
    this.output = (this.output + chunk).slice(-OUTPUT_LIMIT);
    if (this.afterSubmit !== null) return this.heardAfterSubmit(driver, chunk);
    if (this.snapshot.state !== "starting" && this.snapshot.state !== "awaiting_user") return;
    const fields = driver.read(this.output);
    const next: LoginSnapshot = {
      ...this.snapshot,
      url: fields.url ?? this.snapshot.url,
      code: fields.code ?? this.snapshot.code,
      needsCode: fields.needsCode ?? this.snapshot.needsCode,
      message: fields.message ?? this.snapshot.message,
    };
    if (driver.ready(next)) next.state = "awaiting_user";
    if (JSON.stringify(next) !== JSON.stringify(this.snapshot)) this.set(next);
  }

  private heardAfterSubmit(driver: LoginDriver, chunk: string): void {
    this.afterSubmit = `${this.afterSubmit ?? ""}${chunk}`.slice(-OUTPUT_LIMIT);
    if (this.snapshot.state !== "verifying" || driver.read(this.afterSubmit).needsCode !== true) return;
    this.afterSubmit = null;
    this.set({ ...this.snapshot, state: "awaiting_user", needsCode: true, message: "The CLI asked for the code again: it did not accept the one sent. Paste the code shown on the sign-in page." });
  }

  private async exited(driver: LoginDriver, handle: ProcessHandle, exit: ExitInfo): Promise<void> {
    if (this.handle !== handle) return;
    if (this.timer) clearTimeout(this.timer);
    this.handle = null;
    if (this.ending !== null) return this.finish(this.ending, this.ending === "cancelled" ? "Sign-in cancelled." : "Sign-in timed out: nobody finished it in time.");
    if (exit.code !== 0) return this.finish("failed", redactSecrets(driver.failure(this.output, exit)));
    this.set({ ...this.snapshot, state: "verifying", message: "Checking the sign-in with the CLI's status command…" });
    const verdict = await driver.verify().catch(() => ({ ok: false, message: "The CLI's status command could not be run." }));
    this.finish(verdict.ok ? "connected" : "failed", verdict.message);
  }

  private finish(state: LoginState, message: string | null): void {
    this.set({ ...this.snapshot, state, message, needsCode: false, code: null });
  }

  private set(next: LoginSnapshot): void {
    this.snapshot = { ...next, updatedAt: new Date().toISOString() };
    for (const listener of this.listeners) listener(this.current());
  }
}

// The last line of output that says something, for a failure message.
export function lastWords(output: string, exit: ExitInfo): string {
  const line = output.split("\n").map((l) => l.trim()).filter((l) => l.length > 0).at(-1);
  if (exit.spawnError) return `The CLI could not be started (${exit.spawnError}).`;
  return line ? line.slice(0, 300) : `The CLI exited with code ${exit.code ?? exit.signal}.`;
}
