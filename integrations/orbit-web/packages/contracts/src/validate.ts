// Input rules, written once and enforced by the API (the web app uses the same functions only to say early what the
// API would refuse). Plain functions over `unknown`: no schema library.
import {
  isEffortChoice,
  isModeChoice,
  isModelChoice,
  isRepositorySource,
  MODE_CHOICES,
  REPOSITORY_SOURCES,
  type EffortChoice,
  type ModeChoice,
  type ModelChoice,
  type RepositorySource,
} from "./models.js";
import { imageIdsProblem } from "./images.js";
import { THEMES, type ThemePreference } from "./status.js";
import type {
  AzureLoginRequest,
  ChangeBranchRequest,
  ClaudeLoginCodeRequest,
  ShareRequest,
  CreateSessionRequest,
  RepositoryRef,
  SendMessageRequest,
  UpdateAccessRequest,
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

// An Azure DevOps organization name (letters, digits, hyphens; never something an argument parser reads as an option),
// and a repository id (a GUID).
const AZURE_ORGANIZATION = /^[A-Za-z0-9][A-Za-z0-9-]{0,49}$/;
const GUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export const isAzureOrganization = (v: unknown): v is string => typeof v === "string" && AZURE_ORGANIZATION.test(v);

export const isGuid = (v: unknown): v is string => typeof v === "string" && GUID.test(v);

// An Azure DevOps repository's id as the API names it: `organization/<repository id>`.
export function splitAzureId(id: unknown): { organization: string; repositoryId: string } | null {
  if (typeof id !== "string") return null;
  const parts = id.split("/");
  if (parts.length !== 2) return null;
  const [organization, repositoryId] = parts as [string, string];
  return isAzureOrganization(organization) && isGuid(repositoryId) ? { organization, repositoryId: repositoryId.toLowerCase() } : null;
}

// A repository reference the API accepts: a known source, and an id of that source's shape.
export function isRepositoryRef(v: unknown): v is RepositoryRef {
  if (!isRecord(v) || Object.keys(v).some((k) => k !== "source" && k !== "id") || !isRepositorySource(v.source)) return false;
  return v.source === "github" ? splitFullName(v.id) !== null : splitAzureId(v.id) !== null;
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

// The words beside an image: any, none included.
const isMessageText = (v: unknown): v is string => typeof v === "string" && v.length <= LIMITS.promptLength;

export const isTheme = (v: unknown): v is ThemePreference => typeof v === "string" && (THEMES as readonly string[]).includes(v);

const unknownFields = (body: Record<string, unknown>, allowed: readonly string[]): string[] =>
  Object.keys(body).filter((k) => !allowed.includes(k)).map((k) => `${k} is not a field of this request`);

const checked = <T>(errors: string[], value: () => T): Checked<T> => (errors.length > 0 ? { ok: false, errors } : { ok: true, value: value() });

// Which models and efforts an account may use is its catalog's (the API holds a choice to it); here, their shape.
const MODELS_SAID = "model must be a model the Claude CLI names (an alias such as sonnet, or a model id)";
const EFFORTS_SAID = "effort must be an effort level the Claude CLI names (such as low, medium or high)";
const MODES_SAID = `mode must be one of ${MODE_CHOICES.join(", ")}`;
const REPOSITORY_SAID = `repository must be { source: ${REPOSITORY_SOURCES.join(" | ")}, id } (GitHub owner/name, Azure DevOps organization/<repository id>)`;

// A chat with a repository (and, optionally, its branch: the default one otherwise), or with none at all.
export function checkCreateSession(body: unknown): Checked<CreateSessionRequest> {
  if (!isRecord(body)) return { ok: false, errors: ["the body must be a JSON object"] };
  const errors = unknownFields(body, ["repository", "branch", "model", "effort", "mode", "title", "prompt", "images"]);
  const images = imageIdsProblem(body.images);
  if (images !== null) errors.push(images);
  const repository = body.repository ?? null;
  const branch = body.branch ?? null;
  if (repository !== null && !isRepositoryRef(repository)) errors.push(REPOSITORY_SAID);
  if (branch !== null && !isBranchName(branch)) errors.push("branch must be a valid branch name");
  if (repository === null && branch !== null) errors.push("branch needs a repository");
  if (!isModelChoice(body.model)) errors.push(MODELS_SAID);
  if (body.effort !== undefined && !isEffortChoice(body.effort)) errors.push(EFFORTS_SAID);
  if (body.mode !== undefined && !isModeChoice(body.mode)) errors.push(MODES_SAID);
  if (body.title !== undefined && cleanTitle(body.title) === null) errors.push(`title must be 1-${LIMITS.titleLength} printable characters`);
  if (body.prompt !== undefined && !isPromptText(body.prompt)) errors.push(`prompt must be 1-${LIMITS.promptLength} characters`);
  return checked(errors, () => ({
    repository: repository === null ? null : { source: (repository as RepositoryRef).source as RepositorySource, id: (repository as RepositoryRef).id },
    branch: branch as string | null,
    model: body.model as ModelChoice,
    ...(body.effort !== undefined ? { effort: body.effort as EffortChoice } : {}),
    ...(body.mode !== undefined ? { mode: body.mode as ModeChoice } : {}),
    ...(body.title !== undefined ? { title: cleanTitle(body.title) as string } : {}),
    ...(body.prompt !== undefined ? { prompt: body.prompt as string } : {}),
    ...(Array.isArray(body.images) && body.images.length > 0 ? { images: body.images as string[] } : {}),
  }));
}

// A working branch: a branch name git would accept, existing -- or, with `create`, new.
export function checkChangeBranch(body: unknown): Checked<Required<ChangeBranchRequest>> {
  if (!isRecord(body)) return { ok: false, errors: ["the body must be a JSON object"] };
  const errors = unknownFields(body, ["branch", "create"]);
  if (!isBranchName(body.branch)) errors.push("branch must be a valid branch name");
  if (body.create !== undefined && typeof body.create !== "boolean") errors.push("create must be true or false");
  return checked(errors, () => ({ branch: body.branch as string, create: body.create === true }));
}

// Sharing a chat: whether what the tools did is shared too (it is not unless asked).
export function checkShareRequest(body: unknown): Checked<Required<ShareRequest>> {
  if (body === undefined || body === null) return { ok: true, value: { includeTools: false } };
  if (!isRecord(body)) return { ok: false, errors: ["the body must be a JSON object"] };
  const errors = unknownFields(body, ["includeTools"]);
  if (body.includeTools !== undefined && typeof body.includeTools !== "boolean") errors.push("includeTools must be true or false");
  return checked(errors, () => ({ includeTools: body.includeTools === true }));
}

export function checkUpdateSession(body: unknown): Checked<UpdateSessionRequest> {
  if (!isRecord(body)) return { ok: false, errors: ["the body must be a JSON object"] };
  const fields = ["title", "model", "effort", "mode"];
  const errors = unknownFields(body, fields);
  if (fields.every((f) => body[f] === undefined)) errors.push("nothing to change: send title, model, effort or mode");
  if (body.title !== undefined && cleanTitle(body.title) === null) errors.push(`title must be 1-${LIMITS.titleLength} printable characters`);
  if (body.model !== undefined && !isModelChoice(body.model)) errors.push(MODELS_SAID);
  if (body.effort !== undefined && !isEffortChoice(body.effort)) errors.push(EFFORTS_SAID);
  if (body.mode !== undefined && !isModeChoice(body.mode)) errors.push(MODES_SAID);
  return checked(errors, () => ({
    ...(body.title !== undefined ? { title: cleanTitle(body.title) as string } : {}),
    ...(body.model !== undefined ? { model: body.model as ModelChoice } : {}),
    ...(body.effort !== undefined ? { effort: body.effort as EffortChoice } : {}),
    ...(body.mode !== undefined ? { mode: body.mode as ModeChoice } : {}),
  }));
}

// An email a chat or a workspace is shared with: one address, lower case, of a plain shape.
const EMAIL = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

export const SHARE_PEOPLE_LIMIT = 20;

export const normalizeEmail = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const e = v.trim().toLowerCase();
  return e.length <= 254 && EMAIL.test(e) ? e : null;
};

export function checkUpdateAccess(body: unknown): Checked<UpdateAccessRequest> {
  if (!isRecord(body)) return { ok: false, errors: ["the body must be a JSON object"] };
  const errors = unknownFields(body, ["people"]);
  const people = Array.isArray(body.people) ? body.people.map(normalizeEmail) : null;
  if (people === null || people.length > SHARE_PEOPLE_LIMIT) errors.push(`people must be a list of at most ${SHARE_PEOPLE_LIMIT} emails`);
  else if (people.some((p) => p === null)) errors.push("every entry of people must be an email address");
  return checked(errors, () => ({ people: [...new Set(people as string[])] }));
}

// A message: words, images (by id), or both. With an image the words may be none -- the image is the message.
export function checkSendMessage(body: unknown): Checked<SendMessageRequest> {
  if (!isRecord(body)) return { ok: false, errors: ["the body must be a JSON object"] };
  const errors = unknownFields(body, ["text", "images"]);
  const images = imageIdsProblem(body.images);
  if (images !== null) errors.push(images);
  const withImages = Array.isArray(body.images) && body.images.length > 0;
  if (withImages ? !isMessageText(body.text) : !isPromptText(body.text)) errors.push(withImages ? `text must be at most ${LIMITS.promptLength} characters` : `text must be 1-${LIMITS.promptLength} characters`);
  return checked(errors, () => ({ text: body.text as string, ...(withImages ? { images: body.images as string[] } : {}) }));
}

export function checkUpdateSettings(body: unknown): Checked<UpdateSettingsRequest> {
  if (!isRecord(body)) return { ok: false, errors: ["the body must be a JSON object"] };
  const errors = unknownFields(body, ["defaultModel", "defaultEffort", "defaultMode", "projectSkills", "projectPlugins", "webTools", "githubForClaude", "azureForClaude", "theme"]);
  if (body.defaultModel !== undefined && !isModelChoice(body.defaultModel)) errors.push(`default${MODELS_SAID.replace("model", "Model")}`);
  if (body.defaultEffort !== undefined && !isEffortChoice(body.defaultEffort)) errors.push(`default${EFFORTS_SAID.replace("effort", "Effort")}`);
  if (body.defaultMode !== undefined && !isModeChoice(body.defaultMode)) errors.push(`defaultMode must be one of ${MODE_CHOICES.join(", ")}`);
  for (const flag of ["projectSkills", "projectPlugins", "webTools", "githubForClaude", "azureForClaude"]) if (body[flag] !== undefined && typeof body[flag] !== "boolean") errors.push(`${flag} must be true or false`);
  if (body.theme !== undefined && !isTheme(body.theme)) errors.push("theme must be one of system, light, dark");
  return checked(errors, () => ({
    ...(body.defaultModel !== undefined ? { defaultModel: body.defaultModel as ModelChoice } : {}),
    ...(body.defaultEffort !== undefined ? { defaultEffort: body.defaultEffort as EffortChoice } : {}),
    ...(body.defaultMode !== undefined ? { defaultMode: body.defaultMode as ModeChoice } : {}),
    ...(body.projectSkills !== undefined ? { projectSkills: body.projectSkills as boolean } : {}),
    ...(body.projectPlugins !== undefined ? { projectPlugins: body.projectPlugins as boolean } : {}),
    ...(body.webTools !== undefined ? { webTools: body.webTools as boolean } : {}),
    ...(body.githubForClaude !== undefined ? { githubForClaude: body.githubForClaude as boolean } : {}),
    ...(body.azureForClaude !== undefined ? { azureForClaude: body.azureForClaude as boolean } : {}),
    ...(body.theme !== undefined ? { theme: body.theme as ThemePreference } : {}),
  }));
}

// POST /api/claude/login takes nothing: Orbit Web signs in with a Claude account only (`--claudeai`), so there is no
// mode to choose. An empty object is accepted; a field is refused by name (an Anthropic Console account is not offered).
export function checkClaudeLogin(body: unknown): Checked<null> {
  if (body === undefined || body === null) return { ok: true, value: null };
  if (!isRecord(body)) return { ok: false, errors: ["the body must be a JSON object"] };
  return checked(unknownFields(body, []), () => null);
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
