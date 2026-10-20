// Everything about a sqlcmd call that can be decided WITHOUT running it: where
// to connect, what sqlcmd must be told, and whether the query is one this tool
// is allowed to run at all. Pure, so the rules are tested without a database.
import { maskSql, readOnlyProblem as engineProblem } from "../../src/dsl/sql-text.mjs";

export const PREFIX = "ORBIT_SQL_";

const REQUIRED = ["SERVER", "DATABASE"];

// Read-only is enforced twice on purpose. The engine already refuses a case
// whose step is not a SELECT, but this tool is also called by hand and by
// agents, and it is the half that holds the credential.
//
// The SHAPE of the query (one statement, starts with SELECT/WITH, no writing
// word outside a literal or comment) is the engine's check, imported rather than
// written again -- two copies of a safety rule is how one of them rots. What is
// added here is what only THIS vendor's tool should know; the engine serves
// teams on other databases and must never learn these words.
//
// None of it is the real control. The login should hold db_datareader and
// nothing else: a regex protects against a mistake, permissions protect against
// everything.
const VENDOR = /\b(GO|DBCC|RECONFIGURE|SHUTDOWN|BACKUP|RESTORE|WAITFOR|OPENROWSET|OPENQUERY|OPENDATASOURCE|BULK)\b|\b(sp|xp)_\w+/i;

export function readOnlyProblem(sql) {
  const shape = engineProblem(sql);
  if (shape) return `refused: the query ${shape}`;
  return vendorProblem(sql);
}

function vendorProblem(sql) {
  const hit = VENDOR.exec(maskSql(sql));
  return hit ? `refused: ${hit[0]} is not something this tool runs` : null;
}

export function connection(env) {
  const missing = REQUIRED.filter((k) => !env[PREFIX + k]);
  if (missing.length) return { problem: `not configured: set ${missing.map((k) => PREFIX + k).join(" and ")}` };
  return { ...options(env), server: env[PREFIX + "SERVER"], database: env[PREFIX + "DATABASE"], user: env[PREFIX + "USER"] || null };
}

const options = (env) => ({ bin: env[PREFIX + "BIN"] || "sqlcmd", timeout: Number(env[PREFIX + "TIMEOUT"] || 30), trustCert: Boolean(env[PREFIX + "TRUST_CERT"]) });

// `-s | -W` is what makes the output the pipe-separated block under a dashed
// line that the engine's parser anchors on; `-w 65535` stops sqlcmd wrapping a
// long row into two, which would parse as one good row and one silent lie.
// `-b` makes a SQL error a non-zero exit, which the engine reads as BLOCKED.
export function sqlcmdArgs(c, sql) {
  const auth = c.user ? ["-U", c.user] : ["-E"];
  const trust = c.trustCert ? ["-C"] : [];
  return ["-S", c.server, "-d", c.database, ...auth, ...trust, "-l", String(c.timeout), "-t", String(c.timeout), "-s", "|", "-W", "-w", "65535", "-b", "-Q", sql];
}

// The password goes in the CHILD'S ENVIRONMENT, never in argv: sqlcmd reads
// SQLCMDPASSWORD itself, and an argument is visible to every `ps` on the box
// and to any crash dump. It is never printed, logged or written to a file.
export function childEnv(env) {
  const password = env[PREFIX + "PASSWORD"];
  return password ? { ...env, SQLCMDPASSWORD: password } : { ...env };
}
