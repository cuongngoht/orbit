// Input rules, written once and enforced by the API (the web app uses the same functions only to say early what the
// API would refuse). Plain functions over `unknown`: no schema library.
import { isModelChoice, type ModelChoice } from "./models.js";
import { THEMES, type ThemePreference } from "./status.js";
import type {
  AzureLoginRequest,
  ClaudeLoginCodeRequest,
  ClaudeLoginMode,
  CreateSessionRequest,
  SendMessageRequest,
  UpdateSessionRequest,
  UpdateSettingsRequest,
} from "./dto.js";

export type Checked<T> = { ok: true; value: T } | { ok: false; errors: string[] };

export const LIMITS = {
  titleLength: 120,
  promptLength: 100_000,
  loginCodeLength: 2048,
  accessTokenLength: 512,
  branchLength: 255,
} as const;

const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const REPO = /^[A-Za-z0-9._-]{1,100}$/;
// Control characters, and the characters git refuses in a ref name.
// eslint-disable-next-line no-control-regex -- matching control characters is the point
const CONTROL = /[\u0000-\u001f\u007f]/;
// eslint-disable-next-line no-control-regex -- matching control characters is the point
const REF_FORBIDDEN = /[\s~^:?*[\\\u0000-\u001f\u007f]/;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export const isOwnerName = (v: unknown): v is string => typeof v === "string" && OWNER.test(v);

export const isRepoName = (v: unknown): v is string => typeof v === "string" && REPO.test(v) && v !== "." && v !== "..";

export function splitFullName(fullName: unknown): { owner: string; name: string } | null {
  if (typeof fullName !== "string") return null;
  const parts = fullName.split("/");
  if (parts.length !== 2) return null;
  const [owner, name] = parts as [string, string];
  return isOwnerName(owner) && isRepoName(name) ? { owner, name } : null;
}

// A branch name git would accept and no program would read as an option.
export function isBranchName(v: unknown): v is string {
  if (typeof v !== "string" || v.length === 0 || v.length > LIMITS.branchLength) return false;
  if (REF_FORBIDDEN.test(v) || v.includes("..") || v.includes("@{") || v.includes("//")) return false;
  if (v.startsWith("-") || v.startsWith("/") || v.startsWith(".") || v === "@") return false;
  return !(v.endsWith("/") || v.endsWith(".") || v.endsWith(".lock"));
}

export function cleanTitle(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length > 0 && t.length <= LIMITS.titleLength && !CONTROL.test(t) ? t : null;
}

export const isPromptText = (v: unknown): v is string =>
  typeof v === "string" && v.trim().length > 0 && v.length <= LIMITS.promptLength;

export const isTheme = (v: unknown): v is ThemePreference => typeof v === "string" && (THEMES as readonly string[]).includes(v);

const unknownFields = (body: Record<string, unknown>, allowed: readonly string[]): string[] =>
  Object.keys(body).filter((k) => !allowed.includes(k)).map((k) => `${k} is not a field of this request`);

const checked = <T>(errors: string[], value: () => T): Checked<T> => (errors.length > 0 ? { ok: false, errors } : { ok: true, value: value() });

export function checkCreateSession(body: unknown): Checked<CreateSessionRequest> {
  if (!isRecord(body)) return { ok: false, errors: ["the body must be a JSON object"] };
  const errors = unknownFields(body, ["repository", "branch", "model", "title", "prompt"]);
  if (!splitFullName(body.repository)) errors.push("repository must be owner/name");
  if (!isBranchName(body.branch)) errors.push("branch must be a valid branch name");
  if (!isModelChoice(body.model)) errors.push("model must be one of sonnet, opus, haiku");
  if (body.title !== undefined && cleanTitle(body.title) === null) errors.push(`title must be 1-${LIMITS.titleLength} printable characters`);
  if (body.prompt !== undefined && !isPromptText(body.prompt)) errors.push(`prompt must be 1-${LIMITS.promptLength} characters`);
  return checked(errors, () => ({
    repository: body.repository as string,
    branch: body.branch as string,
    model: body.model as ModelChoice,
    ...(body.title !== undefined ? { title: cleanTitle(body.title) as string } : {}),
    ...(body.prompt !== undefined ? { prompt: body.prompt as string } : {}),
  }));
}

export function checkUpdateSession(body: unknown): Checked<UpdateSessionRequest> {
  if (!isRecord(body)) return { ok: false, errors: ["the body must be a JSON object"] };
  const errors = unknownFields(body, ["title", "model"]);
  if (body.title === undefined && body.model === undefined) errors.push("nothing to change: send title or model");
  if (body.title !== undefined && cleanTitle(body.title) === null) errors.push(`title must be 1-${LIMITS.titleLength} printable characters`);
  if (body.model !== undefined && !isModelChoice(body.model)) errors.push("model must be one of sonnet, opus, haiku");
  return checked(errors, () => ({
    ...(body.title !== undefined ? { title: cleanTitle(body.title) as string } : {}),
    ...(body.model !== undefined ? { model: body.model as ModelChoice } : {}),
  }));
}

export function checkSendMessage(body: unknown): Checked<SendMessageRequest> {
  if (!isRecord(body)) return { ok: false, errors: ["the body must be a JSON object"] };
  const errors = unknownFields(body, ["text"]);
  if (!isPromptText(body.text)) errors.push(`text must be 1-${LIMITS.promptLength} characters`);
  return checked(errors, () => ({ text: body.text as string }));
}

export function checkUpdateSettings(body: unknown): Checked<UpdateSettingsRequest> {
  if (!isRecord(body)) return { ok: false, errors: ["the body must be a JSON object"] };
  const errors = unknownFields(body, ["defaultModel", "webTools", "azureForClaude", "theme"]);
  if (body.defaultModel !== undefined && !isModelChoice(body.defaultModel)) errors.push("defaultModel must be one of sonnet, opus, haiku");
  if (body.webTools !== undefined && typeof body.webTools !== "boolean") errors.push("webTools must be true or false");
  if (body.azureForClaude !== undefined && typeof body.azureForClaude !== "boolean") errors.push("azureForClaude must be true or false");
  if (body.theme !== undefined && !isTheme(body.theme)) errors.push("theme must be one of system, light, dark");
  return checked(errors, () => ({
    ...(body.defaultModel !== undefined ? { defaultModel: body.defaultModel as ModelChoice } : {}),
    ...(body.webTools !== undefined ? { webTools: body.webTools as boolean } : {}),
    ...(body.azureForClaude !== undefined ? { azureForClaude: body.azureForClaude as boolean } : {}),
    ...(body.theme !== undefined ? { theme: body.theme as ThemePreference } : {}),
  }));
}

export function checkClaudeLoginMode(body: unknown): Checked<ClaudeLoginMode> {
  if (body === undefined || body === null) return { ok: true, value: "claudeai" };
  if (!isRecord(body)) return { ok: false, errors: ["the body must be a JSON object"] };
  const errors = unknownFields(body, ["mode"]);
  const mode = body.mode ?? "claudeai";
  if (mode !== "claudeai" && mode !== "console") errors.push("mode must be claudeai or console");
  return checked(errors, () => mode as ClaudeLoginMode);
}

// The code a person copies from the Claude sign-in page: printable, no whitespace, bounded.
export function checkLoginCode(body: unknown): Checked<ClaudeLoginCodeRequest> {
  if (!isRecord(body)) return { ok: false, errors: ["the body must be a JSON object"] };
  const errors = unknownFields(body, ["code"]);
  const code = typeof body.code === "string" ? body.code.trim() : "";
  if (code.length === 0 || code.length > LIMITS.loginCodeLength || !/^[\x21-\x7e]+$/.test(code)) errors.push("code must be the code shown on the sign-in page");
  return checked(errors, () => ({ code }));
}

// A Microsoft Entra tenant: its id (a GUID) or a domain it owns. Never something an argument parser could read as an
// option.
const TENANT_ID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const TENANT_DOMAIN = /^(?=.{3,253}$)[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;

export const isTenant = (v: unknown): v is string => typeof v === "string" && (TENANT_ID.test(v) || TENANT_DOMAIN.test(v));

export function checkAzureLogin(body: unknown): Checked<AzureLoginRequest> {
  if (body === undefined || body === null) return { ok: true, value: {} };
  if (!isRecord(body)) return { ok: false, errors: ["the body must be a JSON object"] };
  const errors = unknownFields(body, ["tenant"]);
  const tenant = typeof body.tenant === "string" ? body.tenant.trim() : body.tenant;
  if (tenant !== undefined && tenant !== "" && !isTenant(tenant)) errors.push("tenant must be a tenant id (GUID) or a domain name");
  return checked(errors, () => (typeof tenant === "string" && tenant !== "" ? { tenant } : {}));
}
