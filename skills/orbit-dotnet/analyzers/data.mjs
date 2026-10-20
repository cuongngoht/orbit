// Data access from C#: Entity Framework Core, Dapper, and a raw ADO.NET
// connection -- and WHICH database each one is pointed at, when the code says.
//
// The relation that matters is "EF Core, over SQL Server" or "Dapper, over
// PostgreSQL": the access technology and the database are two technologies, and
// a usage names both -- the access one as `technology`, the database as its
// `integration` -- plus a usage of the database technology itself, so it climbs
// its own ladder. Where the code does not say which database (a DbContext whose
// provider is configured elsewhere) the integration is ABSENT, never guessed
// from whichever database package happens to be declared.
import { code, defines, found, hasNamespace, matching, word } from "./csharp.mjs";

// Which database a call or a connection type points at, and the namespace that
// has to be imported for the type name to mean it.
const PROVIDERS = [
  { re: /\bUseSqlServer\b/, technology: "sql-server" },
  { re: /\bUseNpgsql\b/, technology: "postgresql" },
];

const CONNECTIONS = [
  { re: /\bSqlConnection\b|\bSqlCommand\b/, technology: "sql-server", namespaces: ["Microsoft.Data.SqlClient", "System.Data.SqlClient"] },
  { re: /\bNpgsqlConnection\b|\bNpgsqlDataSource\b|\bNpgsqlCommand\b/, technology: "postgresql", namespaces: ["Npgsql"] },
];

const connectionsIn = (c) => matching(c, CONNECTIONS).filter((row) => row.namespaces.some((ns) => hasNamespace(c, ns)));

const database = (row, c, re) => ({ technology: row.technology, integration: row.technology, confidence: "certain", signals: found(c, re) });

export const efcore = {
  id: "dotnet.efcore",
  ecosystem: "dotnet",
  doc: "Entity Framework Core contexts and entity sets, and the provider a context is configured with",
  requires: ["ef-core"],
  extensions: [".cs"],
  triggers: ["DbContext", "DbSet", "UseSqlServer", "UseNpgsql"],
  operations: ["entities"],
  analyze: ({ text }) => efUsage(code(text)),
};

function efUsage(c) {
  const entities = word(c, "DbSet") || /:\s*DbContext\b/.test(c);
  const providers = matching(c, PROVIDERS);
  if (!entities && !providers.length) return { usages: [], defines: defines(c) };
  const base = { technology: "ef-core", confidence: hasNamespace(c, "Microsoft.EntityFrameworkCore") ? "certain" : "possible", signals: found(c, /\bDbContext\b|\bDbSet\b/) };
  return { defines: defines(c), usages: [...(entities ? [{ ...base, operation: "entities" }] : []), ...providers.flatMap((p) => [{ ...base, integration: p.technology, signals: found(c, p.re) }, database(p, c, p.re)])] };
}

const CALLS = [
  { re: /\.Query(?:First|FirstOrDefault|Single|SingleOrDefault|Multiple)?(?:Async)?\s*[<(]/, operation: "query" },
  { re: /\.Execute(?:Scalar)?(?:Async)?\s*[<(]/, operation: "command" },
];

export const dapper = {
  id: "dotnet.dapper",
  ecosystem: "dotnet",
  doc: "Dapper queries and commands, and the connection type they run over",
  requires: ["dapper"],
  extensions: [".cs"],
  triggers: ["Dapper", "QueryAsync", "ExecuteAsync"],
  operations: CALLS.map((c) => c.operation),
  analyze: ({ text }) => dapperUsage(code(text)),
};

// A Query or Execute call is only Dapper's when the file imports Dapper: the
// same method names belong to half the data libraries there are.
function dapperUsage(c) {
  if (!hasNamespace(c, "Dapper")) return { usages: [], defines: defines(c) };
  const over = connectionsIn(c);
  const calls = matching(c, CALLS);
  const one = (op) => ({ technology: "dapper", confidence: "certain", ...(op ? { operation: op.operation } : {}), ...(over.length === 1 ? { integration: over[0].technology } : {}), signals: ["Dapper", ...(op ? found(c, op.re) : [])] });
  return { defines: defines(c), usages: [...(calls.length ? calls.map(one) : [one(null)]), ...over.map((row) => database(row, c, row.re))] };
}

export const adonet = {
  id: "dotnet.adonet",
  ecosystem: "dotnet",
  doc: "a database reached through its ADO.NET connection type directly",
  requires: ["sql-server", "postgresql"],
  extensions: [".cs"],
  triggers: ["SqlConnection", "NpgsqlConnection", "NpgsqlDataSource"],
  analyze: ({ text }) => adoUsage(code(text)),
};

function adoUsage(c) {
  const over = connectionsIn(c);
  return { defines: defines(c), usages: over.map((row) => database(row, c, row.re)) };
}
