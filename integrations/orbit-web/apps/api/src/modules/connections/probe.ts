// ASKING A CONNECTION'S CLI, NOW -- one class the API and the installation's terminal (cli/connect.ts) both use, so the
// page and the terminal read a connection the same way. It runs each CLI with that connection's OWN home (and, for an
// API-key connection, its own key from the credential store), reads its answer (runtimes.ts), holds it to the two rules
// below, and writes what it found:
//
//   ONE IDENTITY, ONE ACCOUNT. The identity a CLI names is connected to one live connection at a time (the database's
//   unique index `one_account_per_identity`): a home signed in as an identity another connection holds -- of another
//   account above all -- is `auth_required` with `identity_already_connected`, and is never used.
//   THE IDENTITY LINKED. Once connected, a connection is that identity's until it is disconnected: a CLI that names
//   another one is `auth_required` (`identity_changed`); a login that is gone is `auth_required` (`login_ended`).
import { FALLBACK_CATALOG, type ConnectionCatalog, type ConnectionReason, type RuntimeCapabilities, type RuntimeInstallation, type RuntimeKind } from "@orbit-web/contracts";
import type { AppConfig } from "../../config/config.js";
import { CredentialStore } from "../../infra/connections/credentials.js";
import { ensureHome } from "../../infra/connections/homes.js";
import { ConnectionStore, InstallationStore, type ConnectionRecord, type ConnectionStatus } from "../../infra/connections/stores.js";
import { pgCode, UNIQUE_VIOLATION } from "../../infra/db/db.js";
import { agyEnv, claudeEnv, codexEnv, neutralClaudeDir } from "../../infra/process/env.js";
import { LineSplitter } from "../../infra/process/lines.js";
import { endedHow, succeeded, type ProcessPort, type RunResult } from "../../infra/process/process.port.js";
import { redactSecrets, tail } from "../../infra/security/redact.js";
import { parseModelCatalog, PROBE_ARGS, PROBE_REQUEST } from "./claude-models.js";
import { supportOf } from "./methods.js";
import {
  chatgptUnnamed,
  claudeCapabilities,
  CODEX_ACCOUNT_REQUEST,
  codexAccountOf,
  codexAccountReading,
  otherCapabilities,
  parseClaudeStatus,
  readClaudeStatus,
  readCodexStatus,
  readVersion,
  RUNTIME_SPECS,
  UNKNOWN_CAPABILITIES,
  type CodexAccount,
  type StatusReading,
} from "./runtimes.js";

const MODELS_TIMEOUT_MS = 20_000;
// How long Codex's app server has to name the account it is signed in as.
const CODEX_ACCOUNT_TIMEOUT_MS = 15_000;
const MODELS_OUTPUT_BYTES = 2 * 1024 * 1024;
// How long what a CLI said about its installation is used before it is asked again.
const INSTALLATION_MS = 10 * 60_000;

export const noCatalog = (at: string | null): ConnectionCatalog => ({ source: "none", models: [], recommended: null, checkedAt: at });

interface Reading extends StatusReading {
  reasonCode: ConnectionReason | null;
}

export interface ProbeDeps {
  config: AppConfig;
  // Where the CLIs run (the agent's side).
  process: ProcessPort;
  connections: ConnectionStore;
  installations: InstallationStore;
  credentials: CredentialStore;
}

export class ConnectionProbe {
  private readonly installed = new Map<RuntimeKind, { at: number; value: Promise<RuntimeInstallation> }>();
  private readonly helps = new Map<string, Promise<string | null>>();

  constructor(private readonly d: ProbeDeps) {}

  binaryOf(runtime: RuntimeKind): string {
    return this.d.config.binaries[runtime];
  }

  // The environment one connection's CLI runs with: its own home -- and, for an API-key connection of Claude Code, its
  // own key, read from the credential store at this moment. Never anything of another connection's.
  envOf(c: ConnectionRecord): Record<string, string> {
    const dir = ensureHome(this.d.config, c.home, c.runtime);
    if (c.runtime === "claude") return { ...claudeEnv(this.d.config, dir), ...this.secretEnvOf(c) };
    if (c.runtime === "codex") return codexEnv(this.d.config, dir);
    return agyEnv(this.d.config, dir);
  }

  // A Claude Code API-key connection's own key, as the variable Claude Code reads it -- read from the credential store
  // now, and given to that connection's process alone (Codex keeps its key's login in its own home instead).
  secretEnvOf(c: ConnectionRecord): Record<string, string> {
    const key = c.runtime === "claude" && c.method === "api_key" ? this.d.credentials.read(c.credentialRef) : null;
    return key !== null ? { ANTHROPIC_API_KEY: key } : {};
  }

  // The connection's config home for its runtime (made when it is not there yet).
  configDir(c: ConnectionRecord): string {
    return ensureHome(this.d.config, c.home, c.runtime);
  }

  // What is installed of the three CLIs: what each said, asked again once it is older than `maxAgeMs`.
  async installations(maxAgeMs = INSTALLATION_MS): Promise<RuntimeInstallation[]> {
    return Promise.all((["claude", "codex", "agy"] as const).map((r) => this.installation(r, maxAgeMs)));
  }

  installation(runtime: RuntimeKind, maxAgeMs = 0): Promise<RuntimeInstallation> {
    const known = this.installed.get(runtime);
    if (known !== undefined && Date.now() - known.at <= maxAgeMs) return known.value;
    const value = this.askVersion(runtime);
    this.installed.set(runtime, { at: Date.now(), value });
    return value;
  }

  // What the binary can do, from its own `--help` (Claude Code; read once per version).
  async capabilities(installation: RuntimeInstallation): Promise<RuntimeCapabilities> {
    if (installation.state !== "installed") return { ...UNKNOWN_CAPABILITIES, start: "no" };
    if (installation.runtime !== "claude") return otherCapabilities(true);
    const key = installation.version ?? "";
    let help = this.helps.get(key);
    if (help === undefined) {
      help = this.d.process
        .run(this.binaryOf("claude"), ["--help"], { cwd: this.d.config.data.home, env: claudeEnv(this.d.config, neutralClaudeDir(this.d.config)), timeoutMs: this.d.config.limits.commandTimeoutMs })
        .then((r) => (succeeded(r) ? r.stdout : null));
      this.helps.set(key, help);
    }
    return claudeCapabilities(await help);
  }

  // Codex with an API key: the key is handed to `codex login --with-api-key` on its standard input, and Codex keeps the
  // login in the connection's own home (CODEX_HOME). What it said, when it failed.
  async codexKeyLogin(c: ConnectionRecord, key: string): Promise<string | null> {
    const r = await this.d.process.run(this.binaryOf("codex"), ["login", "--with-api-key"], { cwd: this.d.config.data.home, env: this.envOf(c), input: `${key}\n`, timeoutMs: this.d.config.limits.commandTimeoutMs });
    return succeeded(r) ? null : redactSecrets(`codex login --with-api-key ${endedHow(r)}: ${tail(r.stderr || r.stdout, 2)}`).slice(0, 300);
  }

  // THE CHECK: the CLI asked now, its answer held to the rules above, written, and returned.
  async check(c: ConnectionRecord): Promise<ConnectionRecord> {
    const at = new Date().toISOString();
    const installation = await this.installation(c.runtime);
    const capabilities = await this.capabilities(installation);
    const said = await this.read(c, installation);
    const held = said.auth === "connected" ? await this.hold(c, said) : this.unlinked(c, said);
    const catalog = held.auth === "connected" ? await this.catalog(c, at) : noCatalog(at);
    const status: ConnectionStatus = { authState: held.auth, reason: held.reason, reasonCode: held.reasonCode, identity: held.identity, identityKey: held.identityKey, catalog, capabilities, checkedAt: at };
    try {
      return (await this.d.connections.setStatus(c.accountId, c.id, status)) ?? c;
    } catch (err) {
      // Another connection took the identity between the look and the write: this one does not hold it.
      if (pgCode(err) !== UNIQUE_VIOLATION) throw err;
      const taken = { ...status, authState: "auth_required" as const, reason: `${held.identity ?? "This identity"} was connected elsewhere at the same moment. One identity is connected to one account at a time.`, reasonCode: "identity_already_connected" as const, identityKey: null, catalog: noCatalog(at) };
      return (await this.d.connections.setStatus(c.accountId, c.id, taken)) ?? c;
    }
  }

  // What the CLI says, as a reading (nothing held to the rules yet).
  private async read(c: ConnectionRecord, installation: RuntimeInstallation): Promise<Reading> {
    const none = { identity: null, identityKey: null };
    if (c.method === "cloud") return { ...none, auth: "disconnected", reason: supportOf(c.runtime, c.method).note, reasonCode: "not_verified" };
    if (installation.state !== "installed") return { ...none, auth: "error", reason: installation.detail, reasonCode: installation.state === "not_installed" ? "not_installed" : null };
    const spec = RUNTIME_SPECS[c.runtime];
    if (spec.status === null) return { ...none, auth: "error", reason: `${spec.label} documents no command that says whether it is signed in, so Orbit cannot verify a connection of it.`, reasonCode: null };
    const r = await this.d.process.run(this.binaryOf(c.runtime), spec.status, { cwd: this.d.config.data.home, env: this.envOf(c), timeoutMs: this.d.config.limits.commandTimeoutMs });
    if (r.spawnError === "ENOENT") return { ...none, auth: "error", reason: `${spec.label} is not installed on this server.`, reasonCode: "not_installed" };
    if (r.spawnError !== null || r.timedOut) return { ...none, auth: "error", reason: `${spec.label}'s status ${endedHow(r)}.`, reasonCode: null };
    const key = c.method === "api_key" ? this.d.credentials.read(c.credentialRef) : null;
    if (c.runtime === "codex") return this.codexReading(c, r, key);
    const parsed = parseClaudeStatus(r.stdout.trim());
    if (parsed === null) return { ...none, auth: "error", reason: redactSecrets(`claude auth status gave no answer Orbit Web could read (${endedHow(r)}): ${tail(r.stderr, 2)}`).slice(0, 300), reasonCode: null };
    return { ...readClaudeStatus(parsed, c.method, key), reasonCode: null };
  }

  // Codex: its status -- and, for a ChatGPT sign-in its status names nobody in, the account its own app server names.
  private async codexReading(c: ConnectionRecord, r: RunResult, key: string | null): Promise<Reading> {
    const said = readCodexStatus(r, c.method, key);
    if (c.method !== "subscription" || !chatgptUnnamed(r)) return { ...said, reasonCode: null };
    const account = await this.codexAccount(c);
    return { ...(account !== null ? codexAccountReading(account) : said), reasonCode: null };
  }

  // `codex app-server`'s `account/read` (runtimes.ts), in that connection's home. The server answers only while its input
  // stays open: a spawn, ended at the answer, at its exit, or at the deadline (then nothing is named).
  private codexAccount(c: ConnectionRecord): Promise<CodexAccount | null> {
    return new Promise((resolve) => {
      let finished = false;
      const handle = this.d.process.spawn(this.binaryOf("codex"), ["app-server"], { cwd: this.d.config.data.home, env: this.envOf(c) });
      const finish = (account: CodexAccount | null): void => {
        if (finished) return;
        finished = true;
        clearTimeout(deadline);
        handle.closeInput();
        handle.kill("SIGTERM");
        resolve(account);
      };
      const deadline = setTimeout(() => finish(null), CODEX_ACCOUNT_TIMEOUT_MS);
      deadline.unref();
      const splitter = new LineSplitter((line) => {
        const account = codexAccountOf(line);
        if (account !== undefined) finish(account);
      });
      handle.onStdout((chunk) => splitter.push(chunk));
      handle.onExit(() => finish(null));
      handle.write(CODEX_ACCOUNT_REQUEST);
    });
  }

  // A connected reading, held to ONE IDENTITY, ONE ACCOUNT and to the identity this connection was linked to.
  private async hold(c: ConnectionRecord, r: Reading): Promise<Reading> {
    if (c.identityKey !== null && r.identityKey !== c.identityKey) {
      return { auth: "auth_required", reason: `This connection is ${c.identity ?? "another identity"}'s, and its CLI now names ${r.identity ?? "somebody else"}: disconnect it and connect again to change who it is.`, reasonCode: "identity_changed", identity: c.identity, identityKey: c.identityKey };
    }
    const holder = r.identityKey === null ? null : await this.d.connections.holderOf(c.runtime, r.identityKey);
    if (holder !== null && holder.id !== c.id) {
      const where = holder.accountId === c.accountId ? "in another connection of this account: use that one" : "to another Orbit account. One identity is connected to one account at a time -- each person signs in with their own";
      return { auth: "auth_required", reason: `${r.identity ?? "This identity"} is connected ${where}.`, reasonCode: "identity_already_connected", identity: r.identity, identityKey: null };
    }
    return r;
  }

  // A reading that is not connected keeps the identity the connection was linked to; a login that is gone from a linked
  // connection is not "disconnected" (nobody disconnected it) but `auth_required`.
  private unlinked(c: ConnectionRecord, r: Reading): Reading {
    if (c.identityKey !== null && r.auth === "disconnected") return { auth: "auth_required", reason: `The login of ${c.identity ?? "this connection"} in its home is gone (it expired, was revoked, or was signed out elsewhere): sign in again.`, reasonCode: "login_ended", identity: c.identity, identityKey: c.identityKey };
    return { ...r, identity: c.identityKey !== null ? c.identity : null, identityKey: c.identityKey };
  }

  // The models this connection may use, as its own CLI says (Claude Code's control protocol; no model is called). When
  // the CLI cannot be asked: the fallback list, labelled as such (never one an employee runs on). Codex and Antigravity:
  // none, until a catalog of theirs is verified.
  private async catalog(c: ConnectionRecord, at: string): Promise<ConnectionCatalog> {
    if (c.runtime !== "claude") return noCatalog(at);
    const r = await this.d.process.run(this.binaryOf("claude"), PROBE_ARGS, { cwd: this.d.config.data.home, env: this.envOf(c), input: PROBE_REQUEST, timeoutMs: MODELS_TIMEOUT_MS, maxOutputBytes: MODELS_OUTPUT_BYTES });
    const parsed = r.spawnError === null && !r.timedOut ? parseModelCatalog(r.stdout) : null;
    if (parsed === null) return { source: "fallback", models: FALLBACK_CATALOG.models, recommended: FALLBACK_CATALOG.recommended, checkedAt: at };
    return { source: "account", models: parsed.models, recommended: parsed.recommended, checkedAt: at };
  }

  private async askVersion(runtime: RuntimeKind): Promise<RuntimeInstallation> {
    const label = RUNTIME_SPECS[runtime].label;
    const env = runtime === "claude" ? claudeEnv(this.d.config, neutralClaudeDir(this.d.config)) : runtime === "codex" ? codexEnv(this.d.config, this.d.config.data.home) : agyEnv(this.d.config, this.d.config.data.home);
    const r = await this.d.process.run(this.binaryOf(runtime), ["--version"], { cwd: this.d.config.data.home, env, timeoutMs: this.d.config.limits.commandTimeoutMs });
    const reading = readVersion(label, r);
    const value: RuntimeInstallation = { runtime, state: reading.state, version: reading.version, detail: reading.detail, checkedAt: new Date().toISOString() };
    await this.d.installations.set({ ...value, checkedAt: value.checkedAt as string }).catch(() => undefined);
    return value;
  }
}
