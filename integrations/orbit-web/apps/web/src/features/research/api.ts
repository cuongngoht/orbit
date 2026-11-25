// Research's routes, typed (`/api/research/...`). Every one answers only an account that may open the workspace it
// reaches; an upload is the file's own bytes (services/upload.ts).
import type {
  AccessList,
  CreateFindingRequest,
  CreateNoteRequest,
  CreateResearchSessionRequest,
  ResearchFinding,
  ResearchNote,
  ResearchSelection,
  ResearchSessionDetail,
  ResearchSessionSummary,
  ResearchSourceContent,
  ResearchSourceSummary,
  ResearchWorkspaceDetail,
  ResearchWorkspaceSummary,
  RunAccepted,
  UpdateFindingRequest,
} from "@orbit-web/contracts";
import { get, send } from "../../services/api";
import { uploadFile } from "../../services/upload";

export const research = {
  workspaces: () => get<ResearchWorkspaceSummary[]>("/api/research/workspaces"),
  workspace: (id: string) => get<ResearchWorkspaceDetail>(`/api/research/workspaces/${id}`),
  createWorkspace: (name: string, description: string) => send<ResearchWorkspaceSummary>("POST", "/api/research/workspaces", { name, description }),
  deleteWorkspace: (id: string, confirmName: string) => send<void>("DELETE", `/api/research/workspaces/${id}`, { confirmName }),
  workspaceAccessPath: (id: string) => `/api/research/workspaces/${id}/access`,
  sources: (workspaceId: string) => get<ResearchSourceSummary[]>(`/api/research/workspaces/${workspaceId}/sources`),
  upload: (workspaceId: string, file: File, onProgress: (f: number) => void, signal?: AbortSignal) => uploadFile<ResearchSourceSummary>(`/api/research/workspaces/${workspaceId}/sources/upload`, file, onProgress, signal),
  addUrl: (workspaceId: string, url: string, title?: string) => send<ResearchSourceSummary>("POST", `/api/research/workspaces/${workspaceId}/sources/url`, { url, ...(title ? { title } : {}) }),
  addText: (workspaceId: string, title: string, text: string, format: "text" | "markdown") => send<ResearchSourceSummary>("POST", `/api/research/workspaces/${workspaceId}/sources/text`, { title, text, format }),
  renameSource: (id: string, title: string) => send<ResearchSourceSummary>("PATCH", `/api/research/sources/${id}`, { title }),
  retrySource: (id: string) => send<ResearchSourceSummary>("POST", `/api/research/sources/${id}/retry`),
  refreshSource: (id: string) => send<ResearchSourceSummary>("POST", `/api/research/sources/${id}/refresh`),
  deleteSource: (id: string) => send<void>("DELETE", `/api/research/sources/${id}`),
  content: (id: string, revisionId: string | null, around: number | null) => {
    const q = new URLSearchParams();
    if (revisionId !== null) q.set("revision", revisionId);
    if (around !== null) q.set("around", String(around));
    const query = q.toString();
    return get<ResearchSourceContent>(`/api/research/sources/${id}/content${query ? `?${query}` : ""}`);
  },
  createSession: (workspaceId: string, body: CreateResearchSessionRequest) => send<ResearchSessionDetail>("POST", `/api/research/workspaces/${workspaceId}/sessions`, body),
  session: (id: string) => get<ResearchSessionDetail>(`/api/research/sessions/${id}`),
  updateSession: (id: string, change: { title?: string; model?: string; effort?: string }) => send<ResearchSessionSummary>("PATCH", `/api/research/sessions/${id}`, change),
  deleteSession: (id: string) => send<void>("DELETE", `/api/research/sessions/${id}`),
  select: (id: string, sources: string[]) => send<ResearchSelection>("PUT", `/api/research/sessions/${id}/sources`, { sources }),
  ask: (id: string, text: string) => send<RunAccepted>("POST", `/api/research/sessions/${id}/messages`, { text }),
  stop: (id: string) => send<void>("POST", `/api/research/sessions/${id}/stop`),
  notes: (workspaceId: string) => get<ResearchNote[]>(`/api/research/workspaces/${workspaceId}/notes`),
  createNote: (workspaceId: string, body: CreateNoteRequest) => send<ResearchNote>("POST", `/api/research/workspaces/${workspaceId}/notes`, body),
  updateNote: (id: string, change: { title?: string; body?: string }) => send<ResearchNote>("PATCH", `/api/research/notes/${id}`, change),
  deleteNote: (id: string) => send<void>("DELETE", `/api/research/notes/${id}`),
  findings: (workspaceId: string) => get<ResearchFinding[]>(`/api/research/workspaces/${workspaceId}/findings`),
  createFinding: (workspaceId: string, body: CreateFindingRequest) => send<ResearchFinding>("POST", `/api/research/workspaces/${workspaceId}/findings`, body),
  updateFinding: (id: string, change: UpdateFindingRequest) => send<ResearchFinding>("PATCH", `/api/research/findings/${id}`, change),
  deleteFinding: (id: string) => send<void>("DELETE", `/api/research/findings/${id}`),
};

export type { AccessList };
