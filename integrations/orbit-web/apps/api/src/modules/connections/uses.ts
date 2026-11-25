// WHAT A CONNECTION CAN BE USED FOR, decided in ONE place for every reader: the AI Connections page, Hire, the company's
// activation and the office's eligibility all ask this, so a page never offers what the server refuses.
//
// Three questions, kept apart (ADR 0061 §3, §8):
//   is it authenticated?        the CLI's own status (`auth`), read against the connection's home -- never inferred
//   chat / research             which interactive function of Orbit Web it can serve now
//   employee                    whether it can run a governed AI employee now (employeeReadiness: connected, models read
//                               from the account, its model plane observed held to Orbit's tools)
// A use the runtime does not have here at all is `runtime_not_supported`, so a page can leave it out instead of showing
// it switched off. Nothing here runs a program: it reads the facts the last check recorded.
import { CHAT_RUNTIMES, RUNTIME_LABELS, type AuthState, type CompanyActivation, type ConnectionCatalog, type ConnectionUse, type ConnectionUses, type RuntimeCapabilities, type RuntimeKind } from "@orbit-web/contracts";
import { employeeReadiness } from "../../contexts/execution/infrastructure/employee-runtimes.js";

// What a use is decided from: the connection as its last check recorded it.
export interface UseFacts {
  runtime: RuntimeKind;
  label: string;
  auth: AuthState;
  reason: string | null;
  isDefault: boolean;
  catalog: ConnectionCatalog;
  capabilities: RuntimeCapabilities;
}

// Where a person connects or fixes one.
export const AI_CONNECTIONS_HREF = "#/?settings=ai-connections";

const READY: ConnectionUse = { ready: true, reason: null, reasonCode: null };
const not = (reasonCode: NonNullable<ConnectionUse["reasonCode"]>, reason: string): ConnectionUse => ({ ready: false, reason, reasonCode });
const notConnected = (c: UseFacts): ConnectionUse => not("not_connected", `not connected (${c.reason ?? "its CLI says it is not signed in"})`);

// A chat runs on Claude Code or OpenAI Codex, signed in, with the models its CLI listed (as the web app offers it).
function chatUse(c: UseFacts): ConnectionUse {
  if (!(CHAT_RUNTIMES as readonly string[]).includes(c.runtime)) return not("runtime_not_supported", `${RUNTIME_LABELS[c.runtime]} runs no chat in Orbit Web.`);
  if (c.auth !== "connected") return notConnected(c);
  if (c.catalog.models.length === 0) return not("no_models", "its CLI listed no model");
  return READY;
}

// A research question runs on the account's DEFAULT Claude Code connection, signed in (research-runner.service.ts).
function researchUse(c: UseFacts): ConnectionUse {
  if (c.runtime !== "claude") return not("runtime_not_supported", `Research runs on Claude Code, not ${RUNTIME_LABELS[c.runtime]}.`);
  if (!c.isDefault) return not("not_default", "Research runs on the account's default Claude Code connection: make this one the default to use it.");
  if (c.auth !== "connected") return notConnected(c);
  return READY;
}

export function connectionUses(c: UseFacts): ConnectionUses {
  return { chat: chatUse(c), research: researchUse(c), employee: employeeReadiness(c) };
}

// Whether the account can activate its company: one of its own connections usable for chat, research or an employee.
export function activationOf(uses: readonly ConnectionUses[]): CompanyActivation {
  const any = (k: keyof ConnectionUses) => uses.some((u) => u[k].ready);
  const ready = any("chat") || any("research") || any("employee");
  const reason = ready
    ? null
    : uses.length === 0
      ? "Connect an AI CLI first: activating the company needs one AI connection of this account that Orbit Web can use for chat, research or an employee (Settings → AI Connections)."
      : "None of this account's AI connections can be used now (signed out, no models listed, or a runtime Orbit Web runs nothing on): check them in Settings → AI Connections.";
  return { ready, reason, uses: { chat: any("chat"), research: any("research"), employee: any("employee") }, where: AI_CONNECTIONS_HREF };
}
