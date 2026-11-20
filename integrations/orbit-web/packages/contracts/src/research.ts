// RESEARCH: the requests and answers of `/api/research/...`, and the rules each is held to. A research WORKSPACE owns
// knowledge that lasts (its sources, notes and findings); a research SESSION owns one conversation over the sources it
// selects; a RUN answers one question from passages Orbit Web retrieved itself, and its citations are verified against
// those passages by the server -- never taken from the model's word. None of it needs a repository, and none of it is
// approved policy: a finding a person marked `reviewed` is a reviewed research conclusion, nothing more.
import type { AccessLevel } from "./dto.js";
import { cleanTitle, type Checked } from "./validate.js";
import { isEffortChoice, isModelChoice, type EffortChoice, type ModelChoice } from "./models.js";

export const RESEARCH_LIMITS = {
  nameLength: 120,
  descriptionLength: 2_000,
  titleLength: 200,
  // A pasted text travels as JSON under the API's 256 kB body limit: characters, whatever their bytes.
  pastedTextLength: 100_000,
  urlLength: 2_048,
  fileNameLength: 255,
  noteBodyLength: 50_000,
  findingStatementLength: 20_000,
  questionLength: 20_000,
  // Sources one session may select at once, and citations one finding may hold.
  selection: 500,
  findingCitations: 50,
} as const;

export const RESEARCH_SOURCE_KINDS = ["upload", "url", "text"] as const;
export type ResearchSourceKind = (typeof RESEARCH_SOURCE_KINDS)[number];

// What a source's text was read from. Anything else is refused before it is stored.
export const RESEARCH_MEDIA_TYPES = ["pdf", "docx", "html", "markdown", "text"] as const;
export type ResearchMediaType = (typeof RESEARCH_MEDIA_TYPES)[number];

export const RESEARCH_MEDIA_LABELS: Record<ResearchMediaType, string> = { pdf: "PDF", docx: "Word", html: "Web page", markdown: "Markdown", text: "Text" };

// A source's state: `queued` (stored, waiting), `processing` (being read and indexed), `ready` (its current revision is
// indexed), `failed` (nothing usable: the reason says why), `stale` (a URL whose refresh failed: the earlier snapshot is
// still the one used, as of the date it was taken).
export const RESEARCH_SOURCE_STATES = ["queued", "processing", "ready", "failed", "stale"] as const;
export type ResearchSourceState = (typeof RESEARCH_SOURCE_STATES)[number];

// The states whose current revision a question can retrieve from.
export const SEARCHABLE_SOURCE_STATES: readonly ResearchSourceState[] = ["ready", "stale"];

// A research session: `running` while a run answers; the three outcomes after it are what the LAST run came to,
// decided from the process's real exit -- `interrupted` is never `completed`.
export const RESEARCH_SESSION_STATUSES = ["ready", "running", "completed", "failed", "interrupted"] as const;
export type ResearchSessionStatus = (typeof RESEARCH_SESSION_STATUSES)[number];

export const FINDING_STATUSES = ["draft", "needs_review", "reviewed", "rejected"] as const;
export type FindingStatus = (typeof FINDING_STATUSES)[number];

export const FINDING_STATUS_LABELS: Record<FindingStatus, string> = { draft: "Draft", needs_review: "Needs review", reviewed: "Reviewed", rejected: "Rejected" };

// The moves a person may make between a finding's statuses. A finding's text changed after it was reviewed or rejected
// is a draft again: a review is of the words it reviewed.
export const FINDING_MOVES: Record<FindingStatus, readonly FindingStatus[]> = {
  draft: ["needs_review"],
  needs_review: ["reviewed", "rejected", "draft"],
  reviewed: ["draft"],
  rejected: ["draft"],
};

// How a passage came into a run: the full-text search matched the question's words (`fts`), or -- when few did -- it is
// the opening of a selected source, given so a broad question has something to stand on (`lead`).
export type PassageMatch = "fts" | "lead";

export interface ResearchWorkspaceSummary {
  id: string;
  name: string;
  description: string;
  // `owner`: the Claude account that created it; `shared`: its owner shared it with this account's email.
  access: AccessLevel;
  owner: string | null;
  sourceCount: number;
  sessionCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ResearchWorkspaceDetail extends ResearchWorkspaceSummary {
  noteCount: number;
  findingCount: number;
  // Where its documents are kept: on the Orbit server, in its data volume -- not in a browser, and not in a repository.
  storage: string;
}

export interface CreateResearchWorkspaceRequest {
  name: string;
  description?: string;
}

export interface UpdateResearchWorkspaceRequest {
  name?: string;
  description?: string;
}

// Deleting a workspace removes its sources, sessions, notes and findings: its name is typed back to confirm.
export interface DeleteResearchWorkspaceRequest {
  confirmName: string;
}

export interface ResearchRevisionInfo {
  id: string;
  number: number;
  contentHash: string;
  pages: number | null;
  chars: number;
  chunks: number;
  // When a URL's snapshot was taken; null for an upload or a pasted text.
  fetchedAt: string | null;
  indexedAt: string | null;
}

export interface ResearchSourceSummary {
  id: string;
  workspaceId: string;
  kind: ResearchSourceKind;
  title: string;
  // The file's name or the URL as it was given; null for a pasted text.
  origin: string | null;
  mediaType: ResearchMediaType | null;
  state: ResearchSourceState;
  stateReason: string | null;
  // The revision a question retrieves from (null until one is indexed).
  revision: ResearchRevisionInfo | null;
  createdAt: string;
  updatedAt: string;
}

export interface ResearchSourceRevision extends ResearchRevisionInfo {
  byteSize: number;
  mediaType: ResearchMediaType;
  fileName: string | null;
  url: string | null;
  finalUrl: string | null;
  status: "pending" | "indexed" | "failed";
  error: string | null;
  createdAt: string;
  current: boolean;
}

export interface ResearchChunkView {
  ordinal: number;
  page: number | null;
  section: string | null;
  charStart: number;
  charEnd: number;
  text: string;
}

// GET /api/research/sources/:id/content -- a window of one revision's extracted text, in order.
export interface ResearchSourceContent {
  sourceId: string;
  revisionId: string;
  revisionNumber: number;
  current: boolean;
  title: string;
  mediaType: ResearchMediaType;
  totalChunks: number;
  chunks: ResearchChunkView[];
}

export interface AddUrlSourceRequest {
  url: string;
  title?: string;
}

export interface AddTextSourceRequest {
  title: string;
  text: string;
  format?: "text" | "markdown";
}

export interface UpdateSourceRequest {
  title: string;
}

export interface ResearchSessionSummary {
  kind: "research";
  id: string;
  workspaceId: string;
  workspaceName: string;
  title: string;
  model: ModelChoice;
  effort: EffortChoice;
  status: ResearchSessionStatus;
  statusReason: string | null;
  access: AccessLevel;
  owner: string | null;
  selectedSources: number;
  createdAt: string;
  updatedAt: string;
}

// One verified citation: a passage this run was given, as the server resolved its label -- the source and the revision
// it came from, where in it, and the passage's own text.
export interface ResearchCitation {
  id: string;
  label: string;
  messageId: string | null;
  runId: string | null;
  sessionId: string | null;
  sourceId: string;
  revisionId: string;
  revisionNumber: number | null;
  sourceTitle: string;
  // The source is still in the workspace; and the revision cited is the one it retrieves from now.
  sourceAvailable: boolean;
  revisionCurrent: boolean;
  chunkOrdinal: number;
  page: number | null;
  section: string | null;
  charStart: number;
  charEnd: number;
  quote: string;
  match: PassageMatch;
  rank: number;
  score: number | null;
  createdAt: string;
}

export interface ResearchMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  runId: string | null;
  // The run ended while it was written: the text is what had arrived.
  partial: boolean;
  createdAt: string;
  citations: ResearchCitation[];
}

export interface ResearchRunInfo {
  id: string;
  status: "running" | "completed" | "failed" | "interrupted";
  model: string;
  effort: string;
  startedAt: string;
  endedAt: string | null;
  costUsd: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  error: string | null;
  // The sources and revisions this run's evidence was frozen to, and how many passages it was given.
  sources: { sourceId: string; revisionId: string; title: string }[];
  passages: number;
}

export interface ResearchSessionDetail extends ResearchSessionSummary {
  lastSeq: number;
  // The sources this session lets a question retrieve from (ids of the workspace's sources).
  selection: string[];
  // A question given when the session was made, waiting for a source to be ready.
  draftQuestion: string | null;
  messages: ResearchMessage[];
  lastRun: ResearchRunInfo | null;
}

export interface CreateResearchSessionRequest {
  title?: string;
  model: ModelChoice;
  effort?: EffortChoice;
  // The sources it selects; all the workspace's sources when absent.
  sources?: string[];
  // Asked at once when a selected source is ready; kept as the composer's draft otherwise.
  question?: string;
}

export interface UpdateResearchSessionRequest {
  title?: string;
  model?: ModelChoice;
  effort?: EffortChoice;
}

export interface ResearchSelectionRequest {
  sources: string[];
}

export interface ResearchSelection {
  sessionId: string;
  selection: string[];
}

export interface ResearchQuestionRequest {
  text: string;
}

// GET /api/research/sessions/:id/evidence: every citation of the session's answers, newest first.
export interface ResearchEvidence {
  sessionId: string;
  citations: ResearchCitation[];
}

export interface ResearchNote {
  id: string;
  workspaceId: string;
  sessionId: string | null;
  title: string;
  body: string;
  sourceId: string | null;
  citationId: string | null;
  citation: ResearchCitation | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateNoteRequest {
  title: string;
  body: string;
  sessionId?: string;
  sourceId?: string;
  citationId?: string;
}

export interface UpdateNoteRequest {
  title?: string;
  body?: string;
}

export interface ResearchFinding {
  id: string;
  workspaceId: string;
  sessionId: string | null;
  number: number;
  // F-001, F-002 … within the workspace.
  code: string;
  title: string;
  statement: string;
  status: FindingStatus;
  citations: ResearchCitation[];
  reviewedBy: string | null;
  reviewedAt: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateFindingRequest {
  title: string;
  statement: string;
  sessionId?: string;
  citations?: string[];
}

export interface UpdateFindingRequest {
  title?: string;
  statement?: string;
  status?: FindingStatus;
  citations?: string[];
}

export const findingCode = (n: number): string => `F-${String(n).padStart(3, "0")}`;

// The upload route takes the file's bytes as its body (application/octet-stream) and its name in this header,
// URI-encoded: a file is never parsed as a form.
export const UPLOAD_NAME_HEADER = "x-orbit-filename";

export const RESEARCH_UPLOAD_EXTENSIONS = [".pdf", ".docx", ".txt", ".md", ".markdown", ".html", ".htm"] as const;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const isResearchId = (v: unknown): v is string => typeof v === "string" && UUID.test(v);

// eslint-disable-next-line no-control-regex -- control characters are what is refused
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

const unknownFields = (body: Record<string, unknown>, allowed: readonly string[]): string[] =>
  Object.keys(body).filter((k) => !allowed.includes(k)).map((k) => `${k} is not a field of this request`);

const checked = <T>(errors: string[], value: () => T): Checked<T> => (errors.length > 0 ? { ok: false, errors } : { ok: true, value: value() });

const NOT_OBJECT: Checked<never> = { ok: false, errors: ["the body must be a JSON object"] };

// A one-line name: trimmed, printable, bounded.
export function cleanName(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim().replace(/\s+/g, " ");
  return t.length > 0 && t.length <= max && !CONTROL.test(t) ? t : null;
}

// Free text (a description, a note, a statement): bounded, no control characters but line breaks and tabs.
export function cleanText(v: unknown, max: number, allowEmpty = false): string | null {
  if (typeof v !== "string") return null;
  const t = v.replace(/\r\n?/g, "\n");
  if ((!allowEmpty && t.trim().length === 0) || t.length > max || CONTROL.test(t)) return null;
  return allowEmpty ? t : t.trim().length > 0 ? t : null;
}

const idList = (v: unknown, max: number): string[] | null => (Array.isArray(v) && v.length <= max && v.every(isResearchId) ? [...new Set(v as string[])] : null);

export function checkCreateWorkspace(body: unknown): Checked<Required<CreateResearchWorkspaceRequest>> {
  if (!isRecord(body)) return NOT_OBJECT;
  const errors = unknownFields(body, ["name", "description"]);
  const name = cleanName(body.name, RESEARCH_LIMITS.nameLength);
  const description = body.description === undefined ? "" : cleanText(body.description, RESEARCH_LIMITS.descriptionLength, true);
  if (name === null) errors.push(`name must be 1-${RESEARCH_LIMITS.nameLength} printable characters`);
  if (description === null) errors.push(`description must be at most ${RESEARCH_LIMITS.descriptionLength} characters`);
  return checked(errors, () => ({ name: name as string, description: (description as string).trim() }));
}

export function checkUpdateWorkspace(body: unknown): Checked<UpdateResearchWorkspaceRequest> {
  if (!isRecord(body)) return NOT_OBJECT;
  const errors = unknownFields(body, ["name", "description"]);
  if (body.name === undefined && body.description === undefined) errors.push("nothing to change: send name or description");
  const name = body.name === undefined ? undefined : cleanName(body.name, RESEARCH_LIMITS.nameLength);
  const description = body.description === undefined ? undefined : cleanText(body.description, RESEARCH_LIMITS.descriptionLength, true);
  if (name === null) errors.push(`name must be 1-${RESEARCH_LIMITS.nameLength} printable characters`);
  if (description === null) errors.push(`description must be at most ${RESEARCH_LIMITS.descriptionLength} characters`);
  return checked(errors, () => ({ ...(name ? { name } : {}), ...(typeof description === "string" ? { description: description.trim() } : {}) }));
}

export function checkDeleteWorkspace(body: unknown): Checked<DeleteResearchWorkspaceRequest> {
  if (!isRecord(body)) return { ok: false, errors: ["type the workspace's name back as confirmName to delete it"] };
  const errors = unknownFields(body, ["confirmName"]);
  if (typeof body.confirmName !== "string" || body.confirmName.trim().length === 0) errors.push("type the workspace's name back as confirmName to delete it");
  return checked(errors, () => ({ confirmName: (body.confirmName as string).trim().replace(/\s+/g, " ") }));
}

// The WHATWG URL parser both sides have (this package is built without the DOM's or Node's types).
interface ParsedUrl {
  protocol: string;
  hostname: string;
  username: string;
  password: string;
  hash: string;
  toString(): string;
}

const parseUrl = (raw: string): ParsedUrl => new (globalThis as unknown as { URL: new (input: string) => ParsedUrl }).URL(raw);

// Only http and https, with a host, without a user name or password, and never longer than the bound. Where it may
// connect is the fetcher's to decide (it refuses every address that is not on the public internet).
export function checkResearchUrl(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const raw = v.trim();
  if (raw.length === 0 || raw.length > RESEARCH_LIMITS.urlLength || CONTROL.test(raw) || /\s/.test(raw)) return null;
  try {
    const url = parseUrl(raw);
    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.hostname.length === 0 || url.username !== "" || url.password !== "") return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

export function checkAddUrlSource(body: unknown): Checked<AddUrlSourceRequest> {
  if (!isRecord(body)) return NOT_OBJECT;
  const errors = unknownFields(body, ["url", "title"]);
  const url = checkResearchUrl(body.url);
  const title = body.title === undefined ? undefined : cleanName(body.title, RESEARCH_LIMITS.titleLength);
  if (url === null) errors.push("url must be an http or https URL with no user name or password in it");
  if (title === null) errors.push(`title must be 1-${RESEARCH_LIMITS.titleLength} printable characters`);
  return checked(errors, () => ({ url: url as string, ...(title ? { title } : {}) }));
}

export function checkAddTextSource(body: unknown): Checked<Required<AddTextSourceRequest>> {
  if (!isRecord(body)) return NOT_OBJECT;
  const errors = unknownFields(body, ["title", "text", "format"]);
  const title = cleanName(body.title, RESEARCH_LIMITS.titleLength);
  const text = cleanText(body.text, RESEARCH_LIMITS.pastedTextLength);
  if (title === null) errors.push(`title must be 1-${RESEARCH_LIMITS.titleLength} printable characters`);
  if (text === null) errors.push(`text must be 1-${RESEARCH_LIMITS.pastedTextLength} characters`);
  if (body.format !== undefined && body.format !== "text" && body.format !== "markdown") errors.push("format must be text or markdown");
  return checked(errors, () => ({ title: title as string, text: text as string, format: body.format === "markdown" ? "markdown" : "text" }));
}

export function checkUpdateSource(body: unknown): Checked<UpdateSourceRequest> {
  if (!isRecord(body)) return NOT_OBJECT;
  const errors = unknownFields(body, ["title"]);
  const title = cleanName(body.title, RESEARCH_LIMITS.titleLength);
  if (title === null) errors.push(`title must be 1-${RESEARCH_LIMITS.titleLength} printable characters`);
  return checked(errors, () => ({ title: title as string }));
}

// The name an uploaded file carried, for display only: a base name, printable, bounded. It never names a path on the
// server -- stored files are named by their content's hash.
export function cleanFileName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return null;
  }
  const base = decoded.split(/[\\/]/).pop()?.trim() ?? "";
  if (base.length === 0 || base === "." || base === ".." || base.length > RESEARCH_LIMITS.fileNameLength || CONTROL.test(base)) return null;
  return base;
}

export function checkCreateResearchSession(body: unknown): Checked<CreateResearchSessionRequest> {
  if (!isRecord(body)) return NOT_OBJECT;
  const errors = unknownFields(body, ["title", "model", "effort", "sources", "question"]);
  const title = body.title === undefined ? undefined : cleanName(body.title, RESEARCH_LIMITS.titleLength);
  const sources = body.sources === undefined ? undefined : idList(body.sources, RESEARCH_LIMITS.selection);
  const question = body.question === undefined ? undefined : cleanText(body.question, RESEARCH_LIMITS.questionLength);
  if (title === null) errors.push(`title must be 1-${RESEARCH_LIMITS.titleLength} printable characters`);
  if (!isModelChoice(body.model)) errors.push("model must be a model the Claude CLI names");
  if (body.effort !== undefined && !isEffortChoice(body.effort)) errors.push("effort must be an effort level the Claude CLI names");
  if (sources === null) errors.push(`sources must be a list of at most ${RESEARCH_LIMITS.selection} source ids`);
  if (question === null) errors.push(`question must be 1-${RESEARCH_LIMITS.questionLength} characters`);
  return checked(errors, () => ({
    model: body.model as ModelChoice,
    ...(title ? { title } : {}),
    ...(body.effort !== undefined ? { effort: body.effort as EffortChoice } : {}),
    ...(sources ? { sources } : {}),
    ...(question ? { question } : {}),
  }));
}

export function checkUpdateResearchSession(body: unknown): Checked<UpdateResearchSessionRequest> {
  if (!isRecord(body)) return NOT_OBJECT;
  const fields = ["title", "model", "effort"];
  const errors = unknownFields(body, fields);
  if (fields.every((f) => body[f] === undefined)) errors.push("nothing to change: send title, model or effort");
  const title = body.title === undefined ? undefined : cleanTitle(body.title);
  if (title === null) errors.push("title must be 1-120 printable characters");
  if (body.model !== undefined && !isModelChoice(body.model)) errors.push("model must be a model the Claude CLI names");
  if (body.effort !== undefined && !isEffortChoice(body.effort)) errors.push("effort must be an effort level the Claude CLI names");
  return checked(errors, () => ({
    ...(title ? { title } : {}),
    ...(body.model !== undefined ? { model: body.model as ModelChoice } : {}),
    ...(body.effort !== undefined ? { effort: body.effort as EffortChoice } : {}),
  }));
}

export function checkSelection(body: unknown): Checked<ResearchSelectionRequest> {
  if (!isRecord(body)) return NOT_OBJECT;
  const errors = unknownFields(body, ["sources"]);
  const sources = idList(body.sources, RESEARCH_LIMITS.selection);
  if (sources === null) errors.push(`sources must be a list of at most ${RESEARCH_LIMITS.selection} source ids`);
  return checked(errors, () => ({ sources: sources as string[] }));
}

export function checkQuestion(body: unknown): Checked<ResearchQuestionRequest> {
  if (!isRecord(body)) return NOT_OBJECT;
  const errors = unknownFields(body, ["text"]);
  const text = cleanText(body.text, RESEARCH_LIMITS.questionLength);
  if (text === null) errors.push(`text must be 1-${RESEARCH_LIMITS.questionLength} characters`);
  return checked(errors, () => ({ text: text as string }));
}

export function checkCreateNote(body: unknown): Checked<CreateNoteRequest> {
  if (!isRecord(body)) return NOT_OBJECT;
  const errors = unknownFields(body, ["title", "body", "sessionId", "sourceId", "citationId"]);
  const title = cleanName(body.title, RESEARCH_LIMITS.titleLength);
  const text = cleanText(body.body, RESEARCH_LIMITS.noteBodyLength);
  if (title === null) errors.push(`title must be 1-${RESEARCH_LIMITS.titleLength} printable characters`);
  if (text === null) errors.push(`body must be 1-${RESEARCH_LIMITS.noteBodyLength} characters`);
  for (const ref of ["sessionId", "sourceId", "citationId"]) if (body[ref] !== undefined && !isResearchId(body[ref])) errors.push(`${ref} must be an id`);
  return checked(errors, () => ({
    title: title as string,
    body: text as string,
    ...(body.sessionId !== undefined ? { sessionId: body.sessionId as string } : {}),
    ...(body.sourceId !== undefined ? { sourceId: body.sourceId as string } : {}),
    ...(body.citationId !== undefined ? { citationId: body.citationId as string } : {}),
  }));
}

export function checkUpdateNote(body: unknown): Checked<UpdateNoteRequest> {
  if (!isRecord(body)) return NOT_OBJECT;
  const errors = unknownFields(body, ["title", "body"]);
  if (body.title === undefined && body.body === undefined) errors.push("nothing to change: send title or body");
  const title = body.title === undefined ? undefined : cleanName(body.title, RESEARCH_LIMITS.titleLength);
  const text = body.body === undefined ? undefined : cleanText(body.body, RESEARCH_LIMITS.noteBodyLength);
  if (title === null) errors.push(`title must be 1-${RESEARCH_LIMITS.titleLength} printable characters`);
  if (text === null) errors.push(`body must be 1-${RESEARCH_LIMITS.noteBodyLength} characters`);
  return checked(errors, () => ({ ...(title ? { title } : {}), ...(text ? { body: text } : {}) }));
}

const isFindingStatus = (v: unknown): v is FindingStatus => typeof v === "string" && (FINDING_STATUSES as readonly string[]).includes(v);

export function checkCreateFinding(body: unknown): Checked<CreateFindingRequest> {
  if (!isRecord(body)) return NOT_OBJECT;
  const errors = unknownFields(body, ["title", "statement", "sessionId", "citations"]);
  const title = cleanName(body.title, RESEARCH_LIMITS.titleLength);
  const statement = cleanText(body.statement, RESEARCH_LIMITS.findingStatementLength);
  const citations = body.citations === undefined ? undefined : idList(body.citations, RESEARCH_LIMITS.findingCitations);
  if (title === null) errors.push(`title must be 1-${RESEARCH_LIMITS.titleLength} printable characters`);
  if (statement === null) errors.push(`statement must be 1-${RESEARCH_LIMITS.findingStatementLength} characters`);
  if (body.sessionId !== undefined && !isResearchId(body.sessionId)) errors.push("sessionId must be an id");
  if (citations === null) errors.push(`citations must be a list of at most ${RESEARCH_LIMITS.findingCitations} citation ids`);
  return checked(errors, () => ({
    title: title as string,
    statement: statement as string,
    ...(body.sessionId !== undefined ? { sessionId: body.sessionId as string } : {}),
    ...(citations ? { citations } : {}),
  }));
}

export function checkUpdateFinding(body: unknown): Checked<UpdateFindingRequest> {
  if (!isRecord(body)) return NOT_OBJECT;
  const fields = ["title", "statement", "status", "citations"];
  const errors = unknownFields(body, fields);
  if (fields.every((f) => body[f] === undefined)) errors.push("nothing to change: send title, statement, status or citations");
  const title = body.title === undefined ? undefined : cleanName(body.title, RESEARCH_LIMITS.titleLength);
  const statement = body.statement === undefined ? undefined : cleanText(body.statement, RESEARCH_LIMITS.findingStatementLength);
  const citations = body.citations === undefined ? undefined : idList(body.citations, RESEARCH_LIMITS.findingCitations);
  if (title === null) errors.push(`title must be 1-${RESEARCH_LIMITS.titleLength} printable characters`);
  if (statement === null) errors.push(`statement must be 1-${RESEARCH_LIMITS.findingStatementLength} characters`);
  if (body.status !== undefined && !isFindingStatus(body.status)) errors.push(`status must be one of ${FINDING_STATUSES.join(", ")}`);
  if (citations === null) errors.push(`citations must be a list of at most ${RESEARCH_LIMITS.findingCitations} citation ids`);
  return checked(errors, () => ({
    ...(title ? { title } : {}),
    ...(statement ? { statement } : {}),
    ...(body.status !== undefined ? { status: body.status as FindingStatus } : {}),
    ...(citations ? { citations } : {}),
  }));
}
