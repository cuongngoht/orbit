// AI CONNECTIONS (Orbit Web 0.8.0, ADR 0067): what an Orbit account has connected of the three AI CLIs -- Claude Code,
// OpenAI Codex, Google Antigravity (`agy`). A connection is the ACCOUNT's: it has a config home of its own on the server
// (the CLI's login lives there and nowhere else), and it is never mounted into an employee's sandbox.
//
// How a connection signs in is the PROVIDER's own mechanism, never something Orbit makes up:
//   subscription  the official CLI's own sign-in, run against the connection's home: from its card (ADR 0068: Orbit Web
//                 runs the CLI's sign-in, shows the URL -- and Codex's one-time code -- it printed, and hands the code a
//                 person pastes for Claude Code to that process's stdin, keeping none of it), or by a person in a
//                 terminal of the server (`terminalCommand`), where nothing of it passes through Orbit's pages at all.
//   api_key       the account's own key of the provider, entered in the browser, kept by Orbit's credential store and
//                 handed only to that connection's model-plane process.
//   cloud         a cloud provider's credentials (Bedrock / Vertex / Foundry for Claude Code) -- not verified here.
//
// Every status word is VERIFIED by the CLI itself (its version, its own auth-status command run against the connection's
// home, its own model catalog) at `checkedAt`; nothing is inferred from a file being present or a setting being saved.
import type { Checked } from "./validate.js";
import type { ModelOption } from "./models.js";
import type { LoginSnapshot } from "./dto.js";

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const unknownFields = (body: Record<string, unknown>, allowed: readonly string[]): string[] =>
  Object.keys(body).filter((k) => !allowed.includes(k)).map((k) => `${k} is not a field of this request`);
const checked = <T>(errors: string[], value: () => T): Checked<T> => (errors.length > 0 ? { ok: false, errors } : { ok: true, value: value() });
const NOT_OBJECT: Checked<never> = { ok: false, errors: ["the body must be a JSON object"] };
// eslint-disable-next-line no-control-regex -- control characters are what is refused
const CONTROL = /[\u0000-\u001f\u007f]/;

export const RUNTIME_KINDS = ["claude", "codex", "agy"] as const;
export type RuntimeKind = (typeof RUNTIME_KINDS)[number];
export const RUNTIME_LABELS: Record<RuntimeKind, string> = { claude: "Claude Code", codex: "OpenAI Codex", agy: "Google Antigravity" };
export const isRuntimeKind = (v: unknown): v is RuntimeKind => typeof v === "string" && (RUNTIME_KINDS as readonly string[]).includes(v);

// Whether the CLI is on this server, as running it says.
export const INSTALLATION_STATES = ["installed", "not_installed", "error"] as const;
export type InstallationState = (typeof INSTALLATION_STATES)[number];

// What the CLI's own auth-status command, run against the connection's home, says right now.
//   connected       an authenticated identity, named
//   disconnected    no login in this home (never connected, or signed out)
//   auth_required   a login that expired, was revoked, or names another identity than the one linked
//   error           the probe failed or said something Orbit could not read (`reason`)
export const AUTH_STATES = ["connected", "disconnected", "auth_required", "error"] as const;
export type AuthState = (typeof AUTH_STATES)[number];

export const AUTH_STATE_TEXT: Record<AuthState, string> = {
  connected: "Connected",
  disconnected: "Disconnected",
  auth_required: "Authentication required",
  error: "Connection error",
};

export const AUTH_METHODS = ["subscription", "api_key", "cloud"] as const;
export type AuthMethod = (typeof AUTH_METHODS)[number];

// A capability of an adapter on THIS binary: observed, never taken from documentation.
export type Capability = "yes" | "no" | "unknown";

export interface RuntimeCapabilities {
  start: Capability;
  stream: Capability;
  cancel: Capability;
  resume: Capability;
  usage: Capability;
  // The runtime's OWN search (Claude Code's WebSearch, Codex's, AGY's), switchable per run.
  webSearch: Capability;
  // The CLI can run with NO local tool of its own, every shell and file operation going through Orbit's tool plane:
  // what an employee's run needs (fail closed when it is not "yes").
  toolPlaneSplit: Capability;
  // Whether the adapter can say which plugins a run really loaded.
  pluginObservation: Capability;
}

// Whether a way of signing in is offered for a runtime, and on what evidence (the provider's own page, or the binary).
export const METHOD_SUPPORT = ["supported", "not_verified", "not_permitted", "blocked"] as const;
export type MethodSupportState = (typeof METHOD_SUPPORT)[number];

export interface MethodSupport {
  runtime: RuntimeKind;
  method: AuthMethod;
  state: MethodSupportState;
  // In words a person can act on, with the source it rests on.
  note: string;
  source: string | null;
}

export interface RuntimeInstallation {
  runtime: RuntimeKind;
  state: InstallationState;
  version: string | null;
  detail: string | null;
  checkedAt: string | null;
}

// The Orbit plugin on a Claude Code connection: each word means one thing.
//   installed  the plugin is in this installation (its version and digest)
//   approved   the account's owner granted it for a use case, for exactly that digest
export const PLUGIN_USE_CASES = ["chat", "employee"] as const;
export type PluginUseCase = (typeof PLUGIN_USE_CASES)[number];

export interface PluginGrantView {
  plugin: "orbit";
  installed: boolean;
  version: string | null;
  digest: string | null;
  // `needsConfirmation`: a grant exists for another digest (the plugin was upgraded).
  useCases: Record<PluginUseCase, { approved: boolean; needsConfirmation: boolean; decidedAt: string | null }>;
  revision: number;
}

// Whether a connection can run AI employees: connected, its models read from the account, and its model plane observed held
// to Orbit's tools (`reason`: why not, in words a person can act on).
export interface EmployeeReadiness {
  ready: boolean;
  reason: string | null;
}

export interface ConnectionCatalog {
  // `account`: the CLI's own catalog read for this connection. `fallback`: a labelled list for chats only -- an
  // employee never runs on it. `none`: nothing is known.
  source: "account" | "fallback" | "none";
  models: ModelOption[];
  recommended: string | null;
  checkedAt: string | null;
}

export interface RuntimeConnection {
  id: string;
  runtime: RuntimeKind;
  label: string;
  // The account's default connection for this runtime.
  isDefault: boolean;
  method: AuthMethod;
  auth: AuthState;
  // Why it is not connected, in words a person can act on.
  reason: string | null;
  // The same as a code a page can act on (CONNECTION_REASONS, e.g. `identity_already_connected`), when there is one.
  reasonCode: string | null;
  // The identity the CLI says it is signed in as (an email, an organization), when it says.
  identity: string | null;
  checkedAt: string | null;
  catalog: ConnectionCatalog;
  capabilities: RuntimeCapabilities;
  // For a subscription: the one command a person runs in a terminal of the server to sign this connection in.
  terminalCommand: string | null;
  // Whether this connection can be signed in from its card (ConnectionSignIn): a subscription whose CLI's own sign-in
  // Orbit Web knows how to relay (Claude Code, OpenAI Codex), unless the operator switched it off.
  signInHere: boolean;
  // Claude Code only.
  plugins: PluginGrantView | null;
  // How many employees run on it (a disconnect stops their new work).
  employees: number;
  // Whether an employee can be hired on it and run with it now, and why not (the reason a person acts on).
  employeeReady: EmployeeReadiness;
  version: number;
  createdAt: string;
}

export interface AiConnectionsView {
  installations: RuntimeInstallation[];
  connections: RuntimeConnection[];
  methods: MethodSupport[];
  // Whether the account can hire: at least one connection connected with a catalog read from its CLI.
  canHire: boolean;
  asOf: string;
}

export interface CreateConnectionRequest {
  runtime: RuntimeKind;
  label?: string;
  method: AuthMethod;
  // api_key only: the key itself (sent once, kept by the server's credential store, never returned).
  apiKey?: string;
  // cloud only (Claude Code): which provider, and the non-secret settings it needs.
  cloud?: { provider: "bedrock" | "vertex" | "foundry"; region?: string; project?: string };
}

export interface UpdateConnectionRequest {
  label?: string;
  isDefault?: boolean;
  apiKey?: string;
}

export interface UpdatePluginGrantRequest {
  useCase: PluginUseCase;
  approved: boolean;
  // The digest the person saw (a grant is for exactly it).
  digest: string;
}

export const CONNECTION_ERRORS = {
  identityAlreadyConnected: "identity_already_connected",
  notInstalled: "runtime_not_installed",
  methodNotSupported: "method_not_supported",
  connectionInUse: "connection_in_use",
  connectionUnavailable: "connection_unavailable",
  connectionRequired: "connection_required",
  // The Orbit plugin's digest is not the one the page showed (it was upgraded in between): read it again.
  pluginChanged: "plugin_changed",
  // The Orbit plugin is offered on Claude Code connections only.
  pluginNotOffered: "plugin_not_offered",
  // A sign-in from the card (ConnectionSignIn): not offered for this connection; another browser of the account has one
  // under way; nothing under way for this browser.
  signInNotOffered: "sign_in_not_offered",
  signInBusy: "sign_in_busy",
  noSignIn: "no_sign_in",
} as const;

// A SIGN-IN FROM THE CARD (ADR 0068): the connection's CLI running its own sign-in on the server, as the page follows it.
// It belongs to the browser session that started it: only that browser sees its URL and code (`mine`), sends the code
// Claude Code asks for, or cancels it; another browser of the account sees that one is under way, and by whom.
//   GET  /api/connections/:id/sign-in          this connection's sign-in, as this browser may see it
//   POST /api/connections/:id/sign-in          starts it (or returns the one this browser has under way)
//   POST /api/connections/:id/sign-in/code     { code } -- Claude Code's code, written to the CLI's stdin and kept nowhere
//   POST /api/connections/:id/sign-in/cancel
export interface ConnectionSignIn {
  connectionId: string;
  // Whether this browser started it.
  mine: boolean;
  // Who started it (shown to the account's other browsers).
  startedBy: string | null;
  // The flow (LoginSnapshot): its URL, code and whether it waits for a code are null/false unless `mine`.
  flow: LoginSnapshot;
}

export interface SignInCodeRequest {
  code: string;
}

// The code a person copies from the provider's page: one token of printable characters, no whitespace inside.
const SIGN_IN_CODE = /^[\x21-\x7e]{4,2048}$/;

export function checkSignInCode(body: unknown): Checked<SignInCodeRequest> {
  if (!isRecord(body)) return NOT_OBJECT;
  const errors = unknownFields(body, ["code"]);
  const code = typeof body.code === "string" ? body.code.trim() : null;
  if (code === null || !SIGN_IN_CODE.test(code)) errors.push("code must be the code the sign-in page shows (4-2048 printable characters, no spaces)");
  return checked(errors, () => ({ code: code as string }));
}

// Why a connection is not connected, as a code (RuntimeConnection.reasonCode).
//   identity_already_connected  the identity its CLI names is connected to another Orbit account (or another connection
//                               of this one): one provider identity, one account
//   identity_changed            its CLI names another identity than the one this connection was linked to
//   login_ended                 the login it had is gone (expired, revoked, signed out elsewhere)
//   not_installed               the runtime's CLI is not on this server
//   not_verified                a method nothing here has verified (a cloud connection)
export const CONNECTION_REASONS = ["identity_already_connected", "identity_changed", "login_ended", "not_installed", "not_verified"] as const;
export type ConnectionReason = (typeof CONNECTION_REASONS)[number];

// What moved on the account's AI connections (the app stream's `connections.changed`): a page that shows them reads
// GET /api/connections again. Ids only.
export const CONNECTION_CHANGES = ["created", "updated", "checked", "disconnected", "removed", "plugins"] as const;
export type ConnectionChange = (typeof CONNECTION_CHANGES)[number];

export interface ConnectionsChangedData {
  connectionId: string;
  runtime: RuntimeKind;
  change: ConnectionChange;
  auth: AuthState;
}

const API_KEY = /^[A-Za-z0-9._\-:/+=]{16,512}$/;
const DIGEST = /^[0-9a-f]{64}$/;

const labelOf = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const t = v.trim().replace(/\s+/g, " ");
  return t.length > 0 && t.length <= 60 && !CONTROL.test(t) ? t : null;
};

export function checkCreateConnection(body: unknown): Checked<CreateConnectionRequest> {
  if (!isRecord(body)) return NOT_OBJECT;
  const errors = unknownFields(body, ["runtime", "label", "method", "apiKey", "cloud"]);
  const label = body.label === undefined ? undefined : labelOf(body.label);
  if (!isRuntimeKind(body.runtime)) errors.push(`runtime must be one of ${RUNTIME_KINDS.join(", ")}`);
  if (!(AUTH_METHODS as readonly unknown[]).includes(body.method)) errors.push(`method must be one of ${AUTH_METHODS.join(", ")}`);
  if (label === null) errors.push("label must be 1-60 printable characters");
  if (body.method === "api_key" && (typeof body.apiKey !== "string" || !API_KEY.test(body.apiKey.trim()))) errors.push("apiKey must be the provider's API key");
  if (body.method !== "api_key" && body.apiKey !== undefined) errors.push("apiKey is only for the api_key method");
  if (body.method === "cloud") {
    const c = body.cloud;
    if (!isRecord(c) || !["bedrock", "vertex", "foundry"].includes(c.provider as string)) errors.push("cloud.provider must be bedrock, vertex or foundry");
  } else if (body.cloud !== undefined) errors.push("cloud is only for the cloud method");
  return checked(errors, () => ({
    runtime: body.runtime as RuntimeKind,
    method: body.method as AuthMethod,
    ...(label !== undefined ? { label: label as string } : {}),
    ...(body.method === "api_key" ? { apiKey: (body.apiKey as string).trim() } : {}),
    ...(body.method === "cloud" ? { cloud: body.cloud as CreateConnectionRequest["cloud"] } : {}),
  }));
}

export function checkUpdateConnection(body: unknown): Checked<UpdateConnectionRequest> {
  if (!isRecord(body)) return NOT_OBJECT;
  const errors = unknownFields(body, ["label", "isDefault", "apiKey"]);
  const label = body.label === undefined ? undefined : labelOf(body.label);
  if (label === null) errors.push("label must be 1-60 printable characters");
  if (body.isDefault !== undefined && body.isDefault !== true) errors.push("isDefault can only be set to true (another connection becomes the default by being chosen)");
  if (body.apiKey !== undefined && (typeof body.apiKey !== "string" || !API_KEY.test(body.apiKey.trim()))) errors.push("apiKey must be the provider's API key");
  if (body.label === undefined && body.isDefault === undefined && body.apiKey === undefined) errors.push("nothing to change");
  return checked(errors, () => ({
    ...(label !== undefined ? { label: label as string } : {}),
    ...(body.isDefault === true ? { isDefault: true } : {}),
    ...(body.apiKey !== undefined ? { apiKey: (body.apiKey as string).trim() } : {}),
  }));
}

export function checkPluginGrant(body: unknown): Checked<UpdatePluginGrantRequest> {
  if (!isRecord(body)) return NOT_OBJECT;
  const errors = unknownFields(body, ["useCase", "approved", "digest"]);
  if (!(PLUGIN_USE_CASES as readonly unknown[]).includes(body.useCase)) errors.push(`useCase must be one of ${PLUGIN_USE_CASES.join(", ")}`);
  if (typeof body.approved !== "boolean") errors.push("approved must be true or false");
  if (typeof body.digest !== "string" || !DIGEST.test(body.digest)) errors.push("digest must be the plugin digest the page showed");
  return checked(errors, () => ({ useCase: body.useCase as PluginUseCase, approved: body.approved as boolean, digest: body.digest as string }));
}
