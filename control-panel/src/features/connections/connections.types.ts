// The shapes control-server answers with for connections
// (control-server/src/connections/operate.mjs). A connection's credential is
// only ever described -- whether it is set and where it comes from -- never
// carried: no field here can hold one. Nor can any field hold an access token:
// a connection that signs in keeps a session a tool holds, and what the page is
// told of it is how it stands.

export interface CredentialView {
  set: boolean;
  from: "vault" | "env" | null;
  /** The environment variable's NAME, when the credential comes from one. */
  name?: string;
}

export interface ConnectionCheck {
  id: string;
  status: "ok" | "forbidden" | "not-found" | "unauthorized" | "missing" | "not-configured" | "warning" | "error" | string;
  permission: string | null;
  message: string | null;
}

export interface ConnectionTest {
  at: string;
  ok: boolean;
  identity: string | null;
  checks: ConnectionCheck[];
}

/**
 * HOW a connection gets in: the strategy a provider's descriptor offers, and that strategy's own options
 * (only those it declares). A connection made before sign-in existed is `{ strategy: "credential" }`.
 */
export interface AuthChoice {
  strategy: string;
  [option: string]: string | boolean;
}

/** The options of a strategy, by the name its descriptor gives them. */
export type AuthOptions = Record<string, string | boolean>;

export interface Connection {
  id: string;
  provider: string;
  label?: string;
  host?: string;
  organization?: string;
  note?: string;
  credential: CredentialView;
  auth: AuthChoice;
  createdAt?: string;
  updatedAt?: string;
  lastTest?: ConnectionTest;
}

export interface ProviderField {
  name: string;
  label: string;
  doc?: string;
  default?: string | boolean;
  required?: boolean;
  type?: "list" | "boolean" | string;
}

/** One option of a strategy: the page draws and checks it from this row and knows no provider. */
export interface AuthOption {
  name: string;
  label: string;
  /** `boolean` is a checkbox; anything else is text, held to `pattern` when there is one. */
  type?: "string" | "boolean" | string;
  pattern?: string;
  doc?: string;
}

/** One way a provider can let a connection in -- by the descriptor's own words. */
export interface AuthStrategy {
  id: string;
  /** `broker`: a session a tool holds, asked for a short-lived token each time. `credential`: a reference to a secret. */
  kind: "broker" | "credential" | string;
  label: string;
  preferred?: boolean;
  doc?: string;
  docs?: string[];
  /** A person must act (in a browser) for it. */
  interactive?: boolean;
  /** Who keeps the session. */
  sessionOwner?: string;
  /** The tool rows that can hold it, in the order they are preferred: where to look for how to get one. */
  tools?: string[];
  options?: AuthOption[];
}

export interface Authentication {
  default: string;
  strategies: AuthStrategy[];
}

export interface Provider {
  id: string;
  label: string;
  connection: { fields: ProviderField[] };
  scope: { fields: ProviderField[] };
  /** How a connection to it can get in. A provider that says nothing offers the credential alone. */
  authentication?: Authentication;
  credential: { kind: string; advice: string; docs: string[] };
  capabilities: { id: string; collections: string[]; required?: boolean; setting?: string; permission: string }[];
}

export interface ConnectionsView {
  connections: Connection[];
  providers: Provider[];
  /** Which OS secret store this machine offers, or null: then only an environment variable can be named. */
  backend: string | null;
}

export interface NewConnection {
  id: string;
  provider: string;
  organization: string;
  host?: string;
  label?: string;
  auth?: AuthChoice;
}

export type CredentialInput = { value: string } | { env: string };

/**
 * How a session stands, as the engine reports it. For a strategy that signs in: `tool-missing`, `sign-in-required`,
 * `interaction-required` (the session ended, or a policy asks for more), `authenticated`, `failed`. For a credential:
 * `credential-set` and `credential-missing`.
 */
export type SessionState = "tool-missing" | "sign-in-required" | "interaction-required" | "authenticated" | "failed" | "credential-set" | "credential-missing";

/** What was found of the program that holds a sign-in. */
export interface AuthTool {
  found: boolean;
  version: string | null;
  /** `orbit-managed` (Orbit's own copy) or `system` (the machine's, used as a program only). */
  source: "orbit-managed" | "system" | string | null;
  /** The tool row Orbit could install by itself, or null. */
  acquirable: string | null;
  tried: { id: string; reason: string | null }[];
}

/** The END STATE a look at, or a move on, a session answers. Never a token and never the prompt the program printed. */
export interface AuthState {
  strategy: string;
  state: SessionState | string;
  tool?: AuthTool;
}

/** One move on a connection's session. A sign-in carries the options its strategy declares. */
export type AuthRun = { action: "check" } | { action: "sign-out" } | { action: "sign-in"; options: AuthOptions };
