// Research through the real API, for its integration tests: a workspace, an upload (the file's own bytes, as the web
// app sends it), and waits for what happens in the background.
import { MUTATION_HEADER, UPLOAD_NAME_HEADER, type ResearchSessionDetail, type ResearchSourceSummary, type ResearchWorkspaceSummary } from "@orbit-web/contracts";
import assert from "node:assert/strict";
import { eventually, type Harness, type Reply } from "./harness.js";

export async function newWorkspace(h: Harness, name = "AI Governance Research"): Promise<ResearchWorkspaceSummary> {
  const r = await h.send("POST", "/api/research/workspaces", { name, description: "Sources on governing AI agents." });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body as ResearchWorkspaceSummary;
}

export async function upload(h: Harness, workspaceId: string, name: string, bytes: Buffer, headers: Record<string, string> = {}): Promise<Reply> {
  const res = await fetch(`${h.url}/api/research/workspaces/${workspaceId}/sources/upload`, {
    method: "POST",
    headers: { [MUTATION_HEADER]: "1", "content-type": "application/octet-stream", [UPLOAD_NAME_HEADER]: encodeURIComponent(name), ...headers },
    body: new Uint8Array(bytes),
  });
  const text = await res.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    // text
  }
  return { status: res.status, body, headers: res.headers };
}

export async function uploaded(h: Harness, workspaceId: string, name: string, bytes: Buffer): Promise<ResearchSourceSummary> {
  const r = await upload(h, workspaceId, name, bytes);
  assert.equal(r.status, 202, JSON.stringify(r.body));
  return r.body as ResearchSourceSummary;
}

// A source once its reading is over (ready, failed or stale).
export const settledSource = (h: Harness, id: string, timeoutMs = 20_000): Promise<ResearchSourceSummary> =>
  eventually(async () => (await h.get(`/api/research/sources/${id}`)).body as ResearchSourceSummary, (s) => s.state === "ready" || s.state === "failed" || s.state === "stale", timeoutMs);

// A research session once its run is over.
export const answered = (h: Harness, id: string): Promise<ResearchSessionDetail> =>
  eventually(async () => (await h.get(`/api/research/sessions/${id}`)).body as ResearchSessionDetail, (s) => s.status !== "running" && s.status !== "ready");

export const errorCode = (r: Reply): string | undefined => (r.body as { error?: { code?: string } } | null)?.error?.code;
