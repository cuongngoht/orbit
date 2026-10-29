import type { AuthChoice, AuthOption, AuthOptions, AuthStrategy, Connection, ConnectionCheck, ConnectionTest, CredentialView, Provider } from "./connections.types";

export const CONNECTIONS_PATH = "/connections";
export const connectionPath = (id: string) => `${CONNECTIONS_PATH}/${encodeURIComponent(id)}`;

// Where a credential comes from, in a person's words -- never what it is.
export function credentialWords(c: CredentialView): string {
  if (!c.set) return "No credential set";
  return c.from === "vault" ? "Stored in this machine's OS secret store" : `From the environment variable ${c.name ?? ""}`;
}

// What a provider that declares no strategies offers: the credential alone, which is what every connection made before sign-in
// existed has.
const CREDENTIAL: AuthStrategy = { id: "credential", kind: "credential", label: "Credential", preferred: true };

export function strategiesOf(provider: Provider | undefined): AuthStrategy[] {
  const declared = provider?.authentication?.strategies ?? [];
  return declared.length ? declared : [CREDENTIAL];
}

export const strategyOf = (connection: Connection, provider: Provider | undefined): AuthStrategy => strategiesOf(provider).find((s) => s.id === connection.auth.strategy) ?? CREDENTIAL;

// How a connection gets in, in a person's words: the way it signs in, or -- for a credential -- where that comes from. One that
// signs in keeps no credential by design, so it is never "No credential set".
export function authLine(connection: Connection, provider: Provider | undefined): string {
  if (connection.auth.strategy === "credential") return credentialWords(connection.credential);
  return strategiesOf(provider).find((s) => s.id === connection.auth.strategy)?.label ?? connection.auth.strategy;
}

const isSet = (value: unknown): value is string | true => value === true || (typeof value === "string" && value.trim() !== "");

/** What is SENT for a strategy: its id and the options it declares that have a value. A blank text and an unticked box are no option. */
export function choiceOf(strategy: AuthStrategy, values: AuthOptions): AuthChoice {
  const kept = (strategy.options ?? []).flatMap((o) => {
    const value = values[o.name];
    return isSet(value) ? [[o.name, typeof value === "string" ? value.trim() : value] as const] : [];
  });
  return { strategy: strategy.id, ...Object.fromEntries(kept) };
}

const canonical = (choice: AuthChoice) => JSON.stringify(Object.entries(choice).filter(([, v]) => isSet(v)).sort(([a], [b]) => a.localeCompare(b)));

/** The same strategy and the same options, whatever order the keys came in. */
export const sameChoice = (a: AuthChoice, b: AuthChoice) => canonical(a) === canonical(b);

/** The options a connection keeps for its strategy: everything but the strategy's name. */
export const optionsOfChoice = (choice: AuthChoice): AuthOptions => Object.fromEntries(Object.entries(choice).filter(([k]) => k !== "strategy"));

// What a value must be, from the descriptor alone: the pattern it declares, and the length the server also holds it to. A pattern this
// browser cannot read is not a reason to refuse: the server decides.
export function optionProblem(option: AuthOption, value: string | boolean | undefined): string | null {
  if (option.type === "boolean" || typeof value !== "string" || !value.trim()) return null;
  return fits(option.pattern, value.trim()) ? null : `Not in the form ${option.label} takes.`;
}

function fits(pattern: string | undefined, text: string): boolean {
  if (text.length > 200) return false;
  try {
    return !pattern || new RegExp(pattern).test(text);
  } catch {
    return true;
  }
}

export const BACKEND_LABEL: Record<string, string> = { "macos-keychain": "macOS Keychain", "windows-dpapi": "Windows (DPAPI, this user only)" };

// A check's status as a badge: its color says whether it needs attention.
export const CHECK_COLOR: Record<string, "success" | "danger" | "warning" | "informative"> = { ok: "success", forbidden: "danger", unauthorized: "danger", "not-found": "danger", missing: "danger", error: "danger", warning: "warning", "not-configured": "informative" };

export const checkColor = (c: ConnectionCheck) => CHECK_COLOR[c.status] ?? "warning";

// The shape a connection id must have, said before the server has to.
export const CONNECTION_ID = /^[a-z0-9][a-z0-9-]{1,47}$/;

// The test this page ran is not always the latest: a report run or the CLI may
// have tested the same connection since, and the refetched record carries it.
export function newerTest(ran: ConnectionTest | undefined, kept: ConnectionTest | undefined): ConnectionTest | undefined {
  if (!ran || !kept) return ran ?? kept;
  return Date.parse(kept.at) > Date.parse(ran.at) ? kept : ran;
}

// Two pages on one host must not read as one run-together name.
export function docLabel(url: string): string {
  const u = new URL(url);
  const tail = u.pathname.split("/").filter(Boolean).pop();
  return tail ? `${u.host} › ${tail}${u.hash}` : u.host;
}
