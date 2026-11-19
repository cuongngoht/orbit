// A session's workspace is always /data/workspaces/<session-id>/repository, and every path Orbit Web reads or
// removes there is checked to resolve (through symlinks) inside that root.
import { existsSync, realpathSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import type { DataDirs } from "../config/config.js";

const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const isSessionId = (id: string): boolean => SESSION_ID.test(id);

export function sessionRoot(data: DataDirs, sessionId: string): string {
  if (!isSessionId(sessionId)) throw new Error("not a session id");
  return join(data.workspaces, sessionId);
}

export const repositoryDir = (data: DataDirs, sessionId: string): string => join(sessionRoot(data, sessionId), "repository");

// Whether `path` resolves inside `root`, following symlinks of whatever part exists.
export function contained(root: string, path: string): boolean {
  const realRoot = existsSync(root) ? realpathSync(root) : resolve(root);
  const realPath = existsSync(path) ? realpathSync(path) : resolve(path);
  const rel = relative(realRoot, realPath);
  return rel === "" || (!rel.startsWith("..") && !rel.startsWith(sep) && rel !== "..");
}
