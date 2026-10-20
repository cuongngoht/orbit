import type { ConnectionCheck, ConnectionTest, CredentialView } from "./connections.types";

export const CONNECTIONS_PATH = "/connections";
export const connectionPath = (id: string) => `${CONNECTIONS_PATH}/${encodeURIComponent(id)}`;

// Where a credential comes from, in a person's words -- never what it is.
export function credentialWords(c: CredentialView): string {
  if (!c.set) return "No credential set";
  return c.from === "vault" ? "Stored in this machine's OS secret store" : `From the environment variable ${c.name ?? ""}`;
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
