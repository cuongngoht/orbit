import assert from "node:assert/strict";
import { test } from "node:test";
import { interpolate } from "../src/dsl/interpolate.mjs";
import { maskSql, readOnlyProblem, unquotedPlaceholders } from "../src/dsl/sql-text.mjs";

// The old check was one prefix regex, /^s*(SELECT|WITH)/i, and all three of
// these passed it -- two of them passed the sqlcmd adapter as well.
test("the shapes a prefix regex let through are refused, each for its own reason", () => {
  assert.match(readOnlyProblem("SELECT 1; DROP TABLE Things"), /must be ONE statement/);
  assert.match(readOnlyProblem("WITH x AS (SELECT Id FROM Things) DELETE FROM Things WHERE Id IN (SELECT Id FROM x)"), /contains DELETE, which writes/);
  assert.match(readOnlyProblem("SELECT * INTO ThingsCopy FROM Things"), /contains INTO, which creates a table/);
  assert.match(readOnlyProblem("UPDATE Things SET x=1"), /must be a read-only SELECT or WITH/);
});

// Masking is lexical: a writing word inside a VALUE or a COMMENT is neither.
// Refusing those would push people into rewriting honest queries.
test("a writing word that is data, a comment or an identifier is still allowed", () => {
  const ok = (sql) => assert.equal(readOnlyProblem(sql), null, sql);
  ok("SELECT COUNT(*) AS n FROM Things WHERE Name='DELETE me'");
  ok("select 1 -- DROP TABLE T");
  ok("select /* DELETE */ 1");
  ok("SELECT [Update] FROM T");
  ok("SELECT 1;");
  ok("SELECT Id FROM Things WHERE Name='O''Brien'");
  ok("SELECT Id FROM T WHERE Name='-- not a comment' AND Id=1");
  ok("  with x as (select 1 a) select * from x");
});

// Masked regions keep their LENGTH, which is what lets a placeholder be located
// inside or outside a quoted value.
test("masking blanks what is not code and keeps every position", () => {
  const sql = "SELECT 1 WHERE a='x' -- c";
  assert.equal(maskSql(sql).length, sql.length);
  assert.equal(maskSql(sql).trimEnd(), "SELECT 1 WHERE a=");
});

// A ${PARAM} loose in the syntax changes the STATEMENT, not the question, and
// no amount of escaping helps once it is there.
test("a placeholder outside a quoted value is named", () => {
  assert.deepEqual(unquotedPlaceholders("SELECT * FROM T WHERE Name='${NAME}'"), []);
  assert.deepEqual(unquotedPlaceholders("SELECT * FROM T WHERE Id = ${ID}"), ["ID"]);
  assert.deepEqual(unquotedPlaceholders("SELECT '${A}' , ${B}"), ["B"]);
});

// The belt to the braces: escaping keeps an injected value INSIDE its literal,
// and the engine re-checks the text the database will really see. This is
// escaping, not binding -- the read-only login is the actual control.
test("a value that tries to escape its literal is still one read-only statement", () => {
  const template = "SELECT Id FROM Things WHERE Name='${NAME}'";
  const injected = interpolate(template, { NAME: "x' OR 1=1; DROP TABLE Things --" }, "sql");
  assert.equal(readOnlyProblem(injected), null, injected);
  assert.match(injected, /'' OR 1=1; DROP TABLE Things --'$/, "the whole of it stayed one value");
  assert.equal(readOnlyProblem(interpolate(template, { NAME: "x" }, "sql")), null);
});
