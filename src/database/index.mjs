// The Database PORT: read-only queries through whatever command the project
// configured (`sql.command` in project.json; the SQL is appended as the last
// argument). The engine never holds a connection string -- credentials stay
// with the configured tool, outside the repo.
//
// The command's exit code is the only reliable signal that a query ran: a SQL
// CLI usually prints connection errors to STDOUT as well. A database that
// cannot be reached is BLOCKED for the caller, never FAILED -- and so is one
// that simply never answers, which is why the command carries a timeout.
import { spawnSync } from "node:child_process";
import { varName } from "../project/env.mjs";
import { parseRows } from "./rows.mjs";

export { parseRows };

export const DEFAULT_DB_TIMEOUT_MS = 120000;

export function createDatabase(command, deps = {}) {
  const { spawn = spawnSync, timeoutMs = DEFAULT_DB_TIMEOUT_MS } = deps;
  if (!command?.length) return { query: () => ({ ok: false, rows: [], error: "no sql.command configured in ui-tests/project.json" }) };
  return { query: (sql) => query(spawn, command, sql, timeoutMs) };
}

function query(spawn, command, sql, timeoutMs) {
  const [bin, ...args] = command;
  const r = spawn(bin, [...args, sql], { encoding: "utf8", timeout: timeoutMs, killSignal: "SIGKILL" });
  if (killed(r)) return { ok: false, rows: [], error: `${bin} was killed after ${timeoutMs / 1000}s — the query never answered (${varName("DB_TIMEOUT")} raises the limit)` };
  return answered(r, bin);
}

function answered(r, bin) {
  const out = (r.stdout ?? "") + (r.stderr ?? "");
  if (r.status !== 0) return { ok: false, rows: [], error: out.trim().split("\n")[0] || `${bin} exited ${r.status}` };
  return { ok: true, rows: parseRows(out), raw: out };
}

const killed = (r) => r?.signal === "SIGKILL" || r?.error?.code === "ETIMEDOUT";
