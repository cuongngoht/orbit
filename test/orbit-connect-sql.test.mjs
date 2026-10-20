import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { sealed } from "./home.mjs";
import { createDatabase } from "../src/database/index.mjs";
import { parseRows } from "../src/database/rows.mjs";
import { childEnv, connection, readOnlyProblem, sqlcmdArgs } from "../skills/orbit-sql/args.mjs";
import { PROBE, preflight } from "../skills/orbit-sql/preflight.mjs";
import { canonical, parseEnvFile, redact, resolveSettings } from "../skills/orbit-sql/settings.mjs";
import { PLACEHOLDER, setupLines } from "../skills/orbit-sql/setup.mjs";

const env = { ORBIT_SQL_SERVER: "db.test", ORBIT_SQL_DATABASE: "App" };
const TOOL = join(dirname(fileURLToPath(import.meta.url)), "..", "skills", "orbit-sql", "sqlcmd.mjs");

test("the tool refuses anything that is not one read-only statement", () => {
  assert.equal(readOnlyProblem("SELECT 1"), null);
  assert.equal(readOnlyProblem("  with x as (select 1 a) select * from x"), null);
  assert.equal(readOnlyProblem("SELECT * FROM T WHERE Name = 'a;b'"), null, "a ; inside a value is data");
  assert.equal(readOnlyProblem("SELECT 1;"), null, "a trailing ; is harmless");
  assert.match(readOnlyProblem("DELETE FROM Things"), /must be a read-only SELECT or WITH/);
  assert.match(readOnlyProblem("SELECT 1; DROP TABLE Things"), /must be ONE statement/);

  // The shape rules come from the engine, so the tool cannot drift from what a
  // case is held to -- these three used to pass here AND in the engine.
  assert.match(readOnlyProblem("WITH x AS (SELECT Id FROM T) DELETE FROM T"), /contains DELETE, which writes/);
  assert.match(readOnlyProblem("SELECT * INTO Copy FROM T"), /contains INTO, which creates a table/);
  assert.equal(readOnlyProblem("SELECT COUNT(*) AS n FROM T WHERE Name='DELETE me'"), null, "a writing word inside a value is data");

  // And what only THIS vendor's tool should know. The engine must never learn
  // these words: it serves teams on other databases.
  assert.match(readOnlyProblem("SELECT 1 GO"), /GO is not something this tool runs/);
  assert.match(readOnlyProblem("SELECT * FROM OPENROWSET('a','b','c')"), /OPENROWSET is not something this tool runs/);
  assert.match(readOnlyProblem("SELECT 1 WHERE 1=(SELECT 1) AND sp_who=1"), /sp_who is not something this tool runs/);
});

test("a missing variable is named, not discovered three frames deeper", () => {
  assert.match(connection({}).problem, /ORBIT_SQL_SERVER and ORBIT_SQL_DATABASE/);
  assert.equal(connection(env).problem, undefined);
  assert.deepEqual(connection(env).user, null);
});

// The engine's parser anchors on a dashed line and splits on pipes; these flags
// are what make sqlcmd print that, so they are part of the contract.
test("the flags produce exactly what the engine's row parser reads", () => {
  const args = sqlcmdArgs(connection(env), "SELECT 1 AS n");
  for (const f of ["-s", "|", "-W", "-w", "65535", "-b"]) assert.ok(args.includes(f), `missing ${f}`);
  assert.deepEqual(args.slice(-2), ["-Q", "SELECT 1 AS n"]);
  assert.deepEqual(parseRows("n|m\n--|--\n1|a\n\n(1 rows affected)"), [{ n: "1", m: "a" }]);
});

test("integrated auth by default, a login only when one is configured", () => {
  assert.ok(sqlcmdArgs(connection(env), "SELECT 1").includes("-E"));
  const withUser = connection({ ...env, ORBIT_SQL_USER: "svc" });
  assert.deepEqual(sqlcmdArgs(withUser, "SELECT 1").slice(4, 6), ["-U", "svc"]);
  assert.ok(!sqlcmdArgs(connection(env), "SELECT 1").includes("-C"), "certificates are trusted only on request");
  assert.ok(sqlcmdArgs(connection({ ...env, ORBIT_SQL_TRUST_CERT: "1" }), "SELECT 1").includes("-C"));
});

// The engine appends the query as the LAST argument; the tool reads the LAST
// argument. Nothing else states that contract, so it is spawned for real. No
// database is reached because both queries stop inside the tool -- and that
// holds only under sealed(), which takes away the ~/.orbit/sql.env this machine
// may have. Scrubbing ORBIT_SQL_* alone left the file, and the file connected.
test("the port's command contract and the tool's argv agree", () => {
  const db = createDatabase(["node", TOOL], { spawn: (bin, args) => spawnSync(bin, args, { encoding: "utf8", env: sealed() }) });
  assert.match(db.query("DELETE FROM Things").error, /must be a read-only SELECT or WITH/);
  assert.match(db.query("SELECT 1").error, /not configured/, "a SELECT got past the read-only gate, so the text arrived");
});

test("the password reaches sqlcmd through its environment, never through argv", () => {
  const full = { ...env, ORBIT_SQL_USER: "svc", ORBIT_SQL_PASSWORD: "s3cret" };
  assert.equal(childEnv(full).SQLCMDPASSWORD, "s3cret");
  assert.ok(!sqlcmdArgs(connection(full), "SELECT 1").some((a) => a.includes("s3cret")));
  assert.ok(!sqlcmdArgs(connection(full), "SELECT 1").includes("-P"));
  assert.equal(childEnv(env).SQLCMDPASSWORD, undefined);
});


// ---------------------------------------------------------------- configuring

// The trap this half exists for: an `export` the user runs now cannot reach a
// process that started before it, so a tool that reads only the environment
// tells somebody "not configured" five seconds after they configured it.
test("the file fills what the environment left unset, and never overrules it", () => {
  const file = "# a comment\nORBIT_SQL_SERVER = from.file\nORBIT_SQL_DATABASE=App\nORBIT_SQL_PASSWORD=p=a=ss\n";
  const { settings, sources } = resolveSettings({ ORBIT_SQL_SERVER: "from.env" }, file);
  assert.equal(settings.ORBIT_SQL_SERVER, "from.env", "the environment wins, so CI never depends on somebody's home directory");
  assert.equal(settings.ORBIT_SQL_DATABASE, "App");
  assert.equal(settings.ORBIT_SQL_PASSWORD, "p=a=ss", "everything after the FIRST = is the value");
  assert.equal(sources.SERVER, "environment");
  assert.match(sources.DATABASE, /sql\.env$/);
  assert.deepEqual(Object.keys(parseEnvFile(file)), ["ORBIT_SQL_SERVER", "ORBIT_SQL_DATABASE", "ORBIT_SQL_PASSWORD"], "only declared canonical keys are parsed");
});

test("SQL config accepts only canonical Orbit variable names", () => {
  for (const k of ["sqlUser", "SQL_USER", "user", "trust cert", "SQLCMDPASSWORD"]) assert.equal(canonical(k), null, k);
  assert.equal(canonical("ORBIT_SQL_USER"), "USER");
  for (const text of ["sqlUser=a", "SQL_USER=a", "mysteryKey=1", "not a setting"]) assert.throws(() => parseEnvFile(text), /Unsupported SQL configuration/);
  assert.equal(canonical("ORBIT_SQL_TRUST_CERT"), "TRUST_CERT");
});

// A credential typed into an agent's chat is a credential in a transcript.
test("setup-hint prints commands for the user's own terminal and never a password", () => {
  const mac = setupLines("mac", { SERVER: "db.test" }).join("\n");
  assert.match(mac, /umask 177/, "the file is unreadable by others BEFORE it holds a password");
  assert.match(mac, /chmod 600 ~\/\.orbit\/sql\.env/);
  assert.match(mac, new RegExp(PLACEHOLDER), "the password is a placeholder the user replaces");
  assert.match(mac, /profile/, "and the other way, which fixes the NEXT session");

  const env = setupLines("mac", {}, true).join("\n");
  assert.match(env, /"ORBIT_SQL_PASSWORD=\$ORBIT_SQL_PASSWORD"/, "--from-env never retypes the secret");
  assert.ok(!env.includes(PLACEHOLDER));
  assert.match(setupLines("win", {}, true).join("\n"), /icacls .* \/inheritance:r/, "Windows has no umask");
});

// ----------------------------------------------------------------- preflight

const ran = (stdout, status = 0) => () => ({ status, stdout, stderr: "" });
const READER = "db|login|reader|owner\n--|--|--|--\nApp|svc_read|1|0\n";
const deps = (over) => ({ env: { ORBIT_SQL_SERVER: "db.test", ORBIT_SQL_DATABASE: "App" }, fileText: "", which: () => "/usr/bin/sqlcmd", installHint: "brew install sqlcmd", warning: null, spawn: ran(READER), ...over });

test("preflight answers the question a BLOCKED run raises: can this machine read it", () => {
  const out = preflight(deps());
  assert.equal(out.code, 0);
  const text = out.lines.join("\n");
  assert.match(text, /connection : OK/);
  assert.match(text, /login {6}: svc_read {3}db_datareader=1 {2}db_owner=0/);
  assert.match(text, /ORBIT_SQL_SERVER {5}: db\.test \[environment\]/, "where each value came from, which is the usual bug");
});

// The account is the guarantee; the regex in args.mjs is the backstop. Saying so
// is the point -- silence would read as "this login is safe".
test("a login that can write is named as such, and the run is still allowed", () => {
  const out = preflight(deps({ spawn: ran("db|login|reader|owner\n--|--|--|--\nApp|sa|1|1\n") }));
  assert.equal(out.code, 0);
  assert.match(out.lines.join("\n"), /NOTE: this login is db_owner/);
});

test("nothing configured is not a database problem, and says which fix reaches THIS session", () => {
  const out = preflight(deps({ env: {} }));
  assert.equal(out.code, 2);
  const text = out.lines.join("\n");
  assert.match(text, /not configured: set ORBIT_SQL_SERVER and ORBIT_SQL_DATABASE/);
  assert.match(text, /export run AFTER this process started cannot reach it/);
  assert.match(text, /~\/\.orbit\/sql\.env {6}works in THIS session/);
});

test("a missing client and a refused connection are told apart", () => {
  assert.match(preflight(deps({ which: () => null })).lines.join("\n"), /sqlcmd is not on PATH — install it: brew install sqlcmd/);
  assert.equal(preflight(deps({ which: () => null })).code, 2);
  const failed = preflight(deps({ spawn: ran("Login failed for user 'svc_read'.", 1) }));
  assert.equal(failed.code, 1, "sqlcmd's own code, which the engine reads as BLOCKED");
  assert.match(failed.lines.join("\n"), /connection : FAILED/);
});

// The probe is a query like any other, so it goes through the gate this tool
// enforces on everybody else. A preflight that could write would be absurd.
test("the probe is read-only, and the password never reaches the page it prints", () => {
  assert.equal(readOnlyProblem(PROBE), null);
  assert.equal(redact("Login failed: hunter2 was rejected", "hunter2"), "Login failed: *** was rejected");
  assert.equal(redact("nothing to hide", undefined), "nothing to hide");
  assert.ok(!preflight(deps({ env: { ORBIT_SQL_SERVER: "s", ORBIT_SQL_DATABASE: "d", ORBIT_SQL_PASSWORD: "hunter2" } })).lines.join("\n").includes("hunter2"));
});
