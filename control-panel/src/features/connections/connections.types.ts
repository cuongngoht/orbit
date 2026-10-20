// The shapes control-server answers with for connections
// (control-server/src/connections/operate.mjs). A connection's credential is
// only ever described -- whether it is set and where it comes from -- never
// carried: no field here can hold one.

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

export interface Connection {
  id: string;
  provider: string;
  label?: string;
  host?: string;
  organization?: string;
  note?: string;
  credential: CredentialView;
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

export interface Provider {
  id: string;
  label: string;
  connection: { fields: ProviderField[] };
  scope: { fields: ProviderField[] };
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
}

export type CredentialInput = { value: string } | { env: string };
