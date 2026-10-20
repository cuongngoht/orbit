import assert from "node:assert/strict";
import { test } from "node:test";
import { maturityOf } from "../src/intelligence/technology/maturity.mjs";
import { dotnetRegistry, project, references } from "./fakes/dotnet.mjs";
import { ensured, world } from "./fakes/intelligence.mjs";
import { SHAREPOINT } from "./fixtures/intelligence/sharepoint.mjs";
import { graph } from "../skills/orbit-dotnet/analyzers/graph.mjs";
import { csom } from "../skills/orbit-dotnet/analyzers/csom.mjs";
import { di } from "../skills/orbit-dotnet/analyzers/di.mjs";
import { DESCRIPTORS } from "../skills/orbit-dotnet/pack.mjs";

function scanned(files) {
  const ctx = world(files, dotnetRegistry());
  ensured(ctx);
  return ctx.intel.all();
}

const of = (facts, kind) => facts.filter((f) => f.kind === kind);
const techs = (facts) => of(facts, "technology").map((f) => f.technology).sort();
const ladder = (facts, t) => Object.fromEntries(maturityOf(facts).find((l) => l.technology === t).rungs.map((r) => [r.name, r.reached]));

// ---- technologies, off declared dependencies ----

test("the catalog is data every row of which the registry accepts", () => {
  assert.ok(DESCRIPTORS.length >= 25);
  assert.doesNotThrow(() => dotnetRegistry());
});

test("common technologies are recognised from what a project file declares", () => {
  const facts = scanned({ "src/App/App.csproj": references("Microsoft.Graph", "Microsoft.SharePointOnline.CSOM", "Npgsql", "Microsoft.Data.SqlClient", "StackExchange.Redis", "Npgsql.EntityFrameworkCore.PostgreSQL", "Azure.Messaging.ServiceBus", "Confluent.Kafka", "Azure.Security.KeyVault.Secrets", "xunit", "Moq") });
  assert.deepEqual(techs(facts), ["azure-key-vault", "azure-service-bus", "ef-core", "kafka", "microsoft-graph", "moq", "postgresql", "redis", "sharepoint-csom", "sql-server", "xunit"]);
});

test("an EF Core provider package names both the ORM and its database", () => {
  const facts = scanned({ "A.csproj": references("Microsoft.EntityFrameworkCore.SqlServer") });
  assert.deepEqual(techs(facts), ["ef-core", "sql-server"]);
});

test("an unknown package is no technology, and it is still recorded as a dependency", () => {
  const facts = scanned({ "A.csproj": references("Acme.Internal.Widgets") });
  assert.deepEqual(techs(facts), []);
  assert.deepEqual(of(facts, "manifest")[0].dependencies, [{ name: "Acme.Internal.Widgets", relationship: "direct" }]);
});

// The false positive the relationship table exists to refuse.
test("central package management alone makes NO technology: a version made available is not a use", () => {
  const facts = scanned({ "Directory.Packages.props": project(`<ItemGroup><PackageVersion Include="Microsoft.Graph" Version="5.0.0" /></ItemGroup>`, ""), "src/A/A.csproj": references("Serilog") });
  assert.ok(!techs(facts).includes("microsoft-graph"), "Directory.Packages.props lists it, and nothing references it");
  const withRef = scanned({ "Directory.Packages.props": project(`<ItemGroup><PackageVersion Include="Microsoft.Graph" Version="5.0.0" /></ItemGroup>`, ""), "src/A/A.csproj": project(`<ItemGroup><PackageReference Include="Microsoft.Graph" /></ItemGroup>`) });
  const graphFact = of(withRef, "technology").find((f) => f.technology === "microsoft-graph");
  assert.deepEqual(graphFact.evidence, ["src/A/A.csproj"], "the project's own reference is the evidence");
});

test("a package a shared build file injects is evidenced by THAT file, and reaches the units beneath it", () => {
  const facts = scanned({ "src/Directory.Build.props": project(`<ItemGroup><PackageReference Include="Serilog" /></ItemGroup>`, ""), "src/A/A.csproj": references(), "tools/B/B.csproj": references() });
  const serilog = of(facts, "technology").find((f) => f.technology === "serilog");
  assert.deepEqual(serilog.evidence, ["src/Directory.Build.props"]);
  assert.match(serilog.because, /imported: a shared build file injects it/);
  assert.deepEqual(of(facts, "manifest").find((m) => m.key === "src/Directory.Build.props").appliesTo, ["src/A/A.csproj"], "tools/ is outside its reach");
});

test("the runtime and its targets are canonical fields, never XML downstream", () => {
  const facts = scanned(SHAREPOINT);
  const eco = of(facts, "ecosystem")[0];
  assert.deepEqual([eco.ecosystem, eco.runtime, eco.targets, eco.sdk, eco.units], ["dotnet", "dotnet", ["net8.0", "net9.0"], "8.0.100", 3]);
  assert.deepEqual(of(facts, "manifest").find((m) => m.key === "src/Api/Api.csproj").projectKinds, ["web"]);
});

// ---- usage: declared is not used ----

test("Graph declared and never used climbs no further than declared", () => {
  const facts = scanned({ "src/W/W.csproj": references("Microsoft.Graph"), "src/W/Plain.cs": "namespace W; public class Plain { }" });
  assert.deepEqual(ladder(facts, "microsoft-graph"), { declared: true, used: false, configured: false, "used-for": false, "architectural-pattern": false });
});

test("a GraphServiceClient with no request builder is USED, and nothing more is claimed", () => {
  const out = graph.analyze({ text: "using Microsoft.Graph;\nclass A { GraphServiceClient c; }" });
  assert.deepEqual(out.usages, [{ technology: "microsoft-graph", confidence: "certain", signals: ["Microsoft.Graph", "GraphServiceClient"] }]);
});

test("Graph drive items through a site are SharePoint files; through /me they are OneDrive; bare, they say they cannot tell", () => {
  const site = graph.analyze({ text: "using Microsoft.Graph;\nclass A { GraphServiceClient c; void F() { c.Sites[\"x\"].Drive.GetAsync(); } }" });
  assert.deepEqual(site.usages.map((u) => [u.integration, u.operation]), [["sharepoint", "files"]], "a site navigated to its drive is not a sites operation");
  const me = graph.analyze({ text: "using Microsoft.Graph;\nclass A { GraphServiceClient c; void F() { c.Me.Drive.GetAsync(); } }" });
  assert.equal(me.usages[0].integration, "onedrive");
  const bare = graph.analyze({ text: "using Microsoft.Graph;\nclass A { GraphServiceClient c; DriveItem d; }" });
  assert.equal(bare.usages[0].integration, undefined);
  assert.match(bare.usages[0].unknowns[0], /SharePoint or OneDrive/);
});

test("Graph Sites on their own are a sites operation, and Users an identity one", () => {
  const out = graph.analyze({ text: "using Microsoft.Graph;\nclass A { GraphServiceClient c; void F() { c.Sites[\"root\"].GetAsync(); c.Users.GetAsync(); } }" });
  assert.deepEqual(out.usages.map((u) => [u.integration, u.operation]), [["sharepoint", "sites"], ["identity", "users"]]);
});

test("CSOM lists come from the object model's members, never from a class or file name", () => {
  const out = csom.analyze({ text: "using Microsoft.SharePoint.Client;\nclass A { void F(ClientContext ctx) { var l = ctx.Web.Lists.GetByTitle(\"t\"); ListItem i; } }" });
  assert.deepEqual(out.usages.map((u) => [u.technology, u.integration, u.operation, u.confidence]), [["sharepoint-csom", "sharepoint", "lists", "certain"]]);
  assert.deepEqual(csom.analyze({ text: "class CsomListService { List<string> names; }" }).usages, [], "a name is an intention, not evidence");
});

test("text inside a comment or a string literal is never evidence", () => {
  assert.deepEqual(graph.analyze({ text: "// GraphServiceClient c; using Microsoft.Graph;\nclass A { string s = \"GraphServiceClient\"; }" }).usages, []);
});

// ---- the acceptance case: two clients, one system, two operations ----

test("Graph and CSOM coexist: SharePoint files are Graph's, SharePoint lists are CSOM's — two facts, never one rule", () => {
  const facts = scanned(SHAREPOINT);
  const sharepoint = of(facts, "integration").filter((f) => f.integration === "sharepoint").map((f) => [f.operation, f.technologies]);
  assert.deepEqual(sharepoint.sort(), [["files", ["microsoft-graph"]], ["lists", ["sharepoint-csom"]]]);
  assert.ok(!of(facts, "integration").some((f) => f.integration === "sharepoint" && !f.operation), "no fact speaks for SharePoint as a whole");
  assert.deepEqual(ladder(facts, "microsoft-graph"), { declared: true, used: true, configured: true, "used-for": true, "architectural-pattern": false });
});

test("a technology's used-for lists what the code does with it, operation by operation", () => {
  const facts = scanned(SHAREPOINT);
  assert.deepEqual(maturityOf(facts).find((l) => l.technology === "microsoft-graph").usedFor, ["sharepoint/files"]);
  assert.deepEqual(maturityOf(facts).find((l) => l.technology === "sharepoint-csom").usedFor, ["sharepoint/lists"]);
});

// ---- data ----

test("EF Core over SQL Server is one relation: the ORM reaching the database, and the database itself used", () => {
  const facts = scanned(SHAREPOINT);
  const sql = of(facts, "integration").find((f) => f.integration === "sql-server");
  assert.deepEqual(sql.technologies, ["ef-core"], "the database's own usage names the system, not a second way of reaching it");
  assert.equal(ladder(facts, "sql-server").used, true);
});

test("Dapper counts only with its namespace imported, and names the database off the connection type", () => {
  const files = { "A.csproj": references("Dapper", "Npgsql"), "src/Repo.cs": "using Dapper;\nusing Npgsql;\nclass Repo { NpgsqlConnection c; void F() { c.QueryAsync<int>(\"select 1\"); } }", "src/NotDapper.cs": "class X { void F(Y y) { y.QueryAsync<int>(); } }" };
  const usages = of(scanned(files), "usage").filter((u) => u.technology === "dapper");
  assert.deepEqual(usages.map((u) => [u.integration, u.operation, u.evidence]), [["postgresql", "query", ["src/Repo.cs"]]]);
});

test("Redis: a connection is a usage whose purpose is UNKNOWN; only the cache registration says cache", () => {
  const facts = scanned({ "A.csproj": references("StackExchange.Redis"), "src/Lock.cs": "using StackExchange.Redis;\nclass Lock { IConnectionMultiplexer m; }", "src/Setup/Cache.cs": "class S { void F(IServiceCollection s) { s.AddStackExchangeRedisCache(o => {}); } }" });
  const redis = of(facts, "usage").filter((u) => u.technology === "redis");
  assert.deepEqual(redis.map((u) => [u.scope[0], u.operation ?? null]).sort(), [["src/Lock.cs", null], ["src/Setup/Cache.cs", "cache"]]);
  assert.ok(redis.find((u) => !u.operation).unknowns.some((x) => /cache, session, lock or queue/.test(x)));
});

// ---- messaging ----

test("messaging roles come from the client's own types, and an unknown side is said", () => {
  const facts = scanned({
    "A.csproj": references("Azure.Messaging.ServiceBus", "Confluent.Kafka", "MassTransit"),
    "src/Out/Sender.cs": "using Azure.Messaging.ServiceBus;\nclass S { ServiceBusSender s; }",
    "src/In/Handler.cs": "using Azure.Messaging.ServiceBus;\nclass H { ServiceBusProcessor p; }",
    "src/K/Produce.cs": "using Confluent.Kafka;\nclass P { void F() { new ProducerBuilder<string, string>(c); } }",
    "src/K2/Only.cs": "using Confluent.Kafka;\nclass Q { ClientConfig c; }",
    "src/M/OrderConsumer.cs": "using MassTransit;\nclass OrderConsumer : IConsumer<Order> { }",
  });
  const rows = of(facts, "usage").map((u) => [u.technology, u.integration ?? null, u.role ?? null]).sort();
  assert.deepEqual(rows, [["azure-service-bus", "service-bus", "consumer"], ["azure-service-bus", "service-bus", "producer"], ["kafka", "kafka", null], ["kafka", "kafka", "producer"], ["masstransit", null, "consumer"]]);
  assert.ok(of(facts, "usage").find((u) => u.technology === "masstransit").unknowns.some((x) => /which transport/.test(x)));
});

// ---- wiring ----

test("standard DI registrations become generic wiring: abstraction, implementation, lifetime", () => {
  const text = `class S { void F(IServiceCollection s) {
    s.AddScoped<IGraphDriveService, GraphDriveService>();
    s.AddSingleton<Clock>();
    s.AddTransient<IFactoryMade>(sp => sp.GetRequiredService<Other>());
    s.AddSingleton<IClient>(sp => new RealClient(1));
    s.AddScoped(typeof(IRepository<>), typeof(Repository<>));
    s.AddHttpClient<IWeather, WeatherClient>(c => c.BaseAddress = new Uri("https://x.test"));
    s.AddHttpClient("github");
    s.AddDbContext<AppDbContext>(o => o.UseSqlServer(""));
    s.Configure<MailOptions>(cfg.GetSection("Mail"));
  } }`;
  const got = di.analyze({ text }).wirings.map((w) => [w.abstraction, w.implementation ?? null, w.lifetime, w.name ?? null]);
  assert.deepEqual(got, [
    ["IGraphDriveService", "GraphDriveService", "scoped", null],
    ["Clock", "Clock", "singleton", null],
    ["IFactoryMade", null, "transient", null],
    ["IClient", "RealClient", "singleton", null],
    ["IWeather", "WeatherClient", "transient", null],
    ["AppDbContext", "AppDbContext", "scoped", null],
    ["IRepository<>", "Repository<>", "scoped", null],
    ["MailOptions", "MailOptions", "options", null],
    ["HttpClient", null, "transient", "github"],
  ]);
});

test("a registration is traced to the technology its implementation uses — configured, not declared", () => {
  const facts = scanned(SHAREPOINT);
  assert.equal(ladder(facts, "sharepoint-csom").configured, true);
  assert.equal(ladder(facts, "redis").configured, true);
});

// ---- what must never be stored ----

test("no secret, connection string, URL or literal from the code reaches any fact", () => {
  const all = JSON.stringify(scanned(SHAREPOINT));
  for (const leak of ["hunter2", "Server=cache", "example.test", "GetConnectionString(\"Main\")", "user:"]) assert.ok(!all.includes(leak), `${leak} was stored`);
  assert.ok(all.includes("\"github\""), "a named client's bare name is the one literal kept");
});

test("a document mentioning a client is not code, and is never read", () => {
  const ctx = world(SHAREPOINT, dotnetRegistry());
  ensured(ctx);
  assert.ok(!ctx.source.calls.paths.includes("docs/notes.md"));
});
