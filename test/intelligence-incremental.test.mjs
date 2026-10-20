import assert from "node:assert/strict";
import { test } from "node:test";
import { trackedSet } from "../src/architecture/record.mjs";
import { ensureFacts } from "../src/intelligence/facts.mjs";
import { dotnetRegistry, references } from "./fakes/dotnet.mjs";
import { ensured, world } from "./fakes/intelligence.mjs";
import { SHAREPOINT } from "./fixtures/intelligence/sharepoint.mjs";

// MEMORY FIRST, as behaviour: what a second `ensure` reads after exactly one
// thing moved. The in-memory source moves a scope the way a commit does -- by
// changing a file under it -- so each test edits one file and counts reads.

function bootstrapped(files = SHAREPOINT) {
  const ctx = world(files, dotnetRegistry());
  ensured(ctx);
  ctx.source.calls.read = 0;
  ctx.source.calls.paths = [];
  ctx.source.calls.search = 0;
  return ctx;
}

const decisionOf = (out) => /INTELLIGENCE (\w+)/.exec(out)[1];
const reads = (ctx) => ctx.source.calls.paths;
const byKey = (ctx, kind, key) => ctx.intel.all().find((f) => f.kind === kind && f.key === key);

test("nothing moved: CURRENT, and not one file read, not one search", () => {
  const ctx = bootstrapped();
  assert.equal(decisionOf(ensured(ctx)), "CURRENT");
  assert.deepEqual(reads(ctx), []);
  assert.equal(ctx.source.calls.search, 0);
});

test("--dry decides and writes nothing, not even a state file", () => {
  const ctx = world(SHAREPOINT, dotnetRegistry());
  const out = ensured(ctx, ["--dry"]);
  assert.equal(decisionOf(out), "BOOTSTRAP");
  assert.match(out, /--dry: \d+ fact\(s\) would be recorded/);
  assert.deepEqual([...ctx.io.files.keys()], []);
});

test("an edited source file re-reads ITS directory and nothing else; the manifests are not read", () => {
  const ctx = bootstrapped();
  const csomBefore = byKey(ctx, "usage", "sharepoint-csom:sharepoint:lists@src/Infrastructure/SharePoint");
  ctx.source.write("src/Infrastructure/Caching/RedisCacheLock.cs", SHAREPOINT["src/Infrastructure/Caching/RedisCacheLock.cs"].replace("class RedisCacheLock", "class RedisCacheLock /* v2 */"));
  assert.equal(decisionOf(ensured(ctx)), "INCREMENTAL");
  assert.deepEqual(reads(ctx), ["src/Infrastructure/Caching/RedisCacheLock.cs"], "only the moved directory's file");
  assert.deepEqual(byKey(ctx, "usage", "sharepoint-csom:sharepoint:lists@src/Infrastructure/SharePoint"), csomBefore, "an unmoved directory's usage is left byte for byte");
});

test("an unchanged project file is not re-read; a changed one re-reads manifests but NO source when nothing new is declared", () => {
  const ctx = bootstrapped();
  const csproj = "src/Infrastructure/Infrastructure.csproj";
  ctx.source.write(csproj, SHAREPOINT[csproj].replace("net8.0;net9.0", "net8.0;net9.0;net10.0"));
  const out = ensured(ctx);
  assert.equal(decisionOf(out), "MANIFESTS");
  assert.ok(reads(ctx).every((p) => !p.endsWith(".cs")), `source was read: ${reads(ctx).filter((p) => p.endsWith(".cs"))}`);
  assert.ok(ctx.intel.all().find((f) => f.kind === "ecosystem").targets.includes("net10.0"));
});

// Easy to miss: an analyser gated on a package nobody declared never looked
// at the files that now matter, however fresh their directories are.
test("a newly declared technology makes every usage worth looking at again", () => {
  const files = { ...SHAREPOINT, "src/Infrastructure/Infrastructure.csproj": SHAREPOINT["src/Infrastructure/Infrastructure.csproj"].replace('<PackageReference Include="Microsoft.SharePointOnline.CSOM" />', "") };
  const ctx = bootstrapped(files);
  assert.ok(!ctx.intel.all().some((f) => f.kind === "usage" && f.technology === "sharepoint-csom"));
  ctx.source.write("src/Infrastructure/Infrastructure.csproj", SHAREPOINT["src/Infrastructure/Infrastructure.csproj"]);
  ensured(ctx);
  assert.ok(reads(ctx).includes("src/Infrastructure/SharePoint/CsomListService.cs"));
  assert.ok(byKey(ctx, "usage", "sharepoint-csom:sharepoint:lists@src/Infrastructure/SharePoint"));
});

test("a manifest that appears is noticed from the listing alone", () => {
  const ctx = bootstrapped();
  ctx.source.write("src/Jobs/Jobs.csproj", references("Confluent.Kafka"));
  assert.equal(decisionOf(ensured(ctx)), "MANIFESTS");
  assert.ok(ctx.intel.all().some((f) => f.kind === "technology" && f.technology === "kafka"));
});

test("a package removed from a project file takes its technology fact with it", () => {
  const ctx = bootstrapped();
  const csproj = "src/Infrastructure/Infrastructure.csproj";
  ctx.source.write(csproj, SHAREPOINT[csproj].replace('<PackageReference Include="Azure.Messaging.ServiceBus" Version="7.17.0" />', ""));
  ensured(ctx);
  assert.ok(!ctx.intel.all().some((f) => f.kind === "technology" && f.technology === "azure-service-bus"));
});

test("code deleted from a directory takes its usage with it", () => {
  const ctx = bootstrapped();
  ctx.source.remove("src/Infrastructure/Messaging/OrderPublisher.cs");
  ensured(ctx);
  assert.ok(!ctx.intel.all().some((f) => f.kind === "usage" && f.technology === "azure-service-bus"));
  assert.ok(!ctx.intel.all().some((f) => f.kind === "integration" && f.integration === "service-bus"));
});

test("a new file in a new directory of a known unit is found", () => {
  const ctx = bootstrapped();
  ctx.source.write("src/Infrastructure/Queues/Listener.cs", "using Azure.Messaging.ServiceBus;\nclass Listener { ServiceBusProcessor p; }");
  assert.equal(decisionOf(ensured(ctx)), "INCREMENTAL");
  assert.deepEqual(reads(ctx), ["src/Infrastructure/Queues/Listener.cs"]);
  assert.ok(byKey(ctx, "usage", "azure-service-bus:service-bus:messages:consumer@src/Infrastructure/Queues"));
});

test("a task about one technology does not re-read another's directory — and says what it skipped", () => {
  const ctx = bootstrapped();
  ctx.source.write("src/Infrastructure/SharePoint/GraphDriveService.cs", `${SHAREPOINT["src/Infrastructure/SharePoint/GraphDriveService.cs"]}\n// edited\n`);
  ctx.source.write("src/Infrastructure/Caching/RedisCacheLock.cs", `${SHAREPOINT["src/Infrastructure/Caching/RedisCacheLock.cs"]}\n// edited\n`);
  const out = ensured(ctx, ["--for=why is redis slow"]);
  assert.ok(!reads(ctx).some((p) => p.includes("SharePoint")), "the SharePoint directory is not this task's business");
  assert.ok(reads(ctx).includes("src/Infrastructure/Caching/RedisCacheLock.cs"));
  assert.match(out, /skipped: .*src\/Infrastructure\/SharePoint/);
  assert.equal(decisionOf(ensured(ctx)), "INCREMENTAL", "what was skipped is still owed, never called current");
});

test("a task naming nothing that moved is CURRENT for that task, and the moved scope is still reported", () => {
  const ctx = bootstrapped();
  ctx.source.write("src/Infrastructure/SharePoint/CsomListService.cs", `${SHAREPOINT["src/Infrastructure/SharePoint/CsomListService.cs"]}\n// edited\n`);
  const out = ensured(ctx, ["--for=postgresql"]);
  assert.equal(decisionOf(out), "CURRENT");
  assert.deepEqual(reads(ctx), []);
  assert.match(out, /skipped: .*src\/Infrastructure\/SharePoint\/CsomListService\.cs/);
});

test("a descriptor added later reads everything again with the new eyes", () => {
  const ctx = bootstrapped();
  ctx.registry.descriptors.register({ id: "acme-widgets", category: "sdk", matchers: [{ ecosystem: "dotnet", dependency: "Acme.Internal.Widgets" }] }, "a project");
  assert.equal(decisionOf(ensured(ctx)), "RECOGNISER_CHANGED");
  assert.ok(ctx.intel.all().some((f) => f.kind === "technology" && f.technology === "acme-widgets"));
});

// ---- provenance and freshness ----

test("every fact's evidence and scope is something the source tree tracks", () => {
  const ctx = bootstrapped();
  const tracked = trackedSet(ctx.source.files());
  for (const f of ctx.intel.all()) {
    for (const p of f.evidence) assert.ok(tracked.has(p), `${f.id} cites ${p}`);
    for (const s of f.scope) assert.ok(tracked.has(s) || s === ".", `${f.id} is scoped to ${s}`);
  }
});

test("every fact carries its stamps, and a clean scope is fresh", () => {
  const ctx = bootstrapped();
  for (const f of ctx.intel.all()) {
    assert.equal(f.status, "fresh", f.id);
    assert.equal(f.commit, "abc1234");
    assert.ok(f.fingerprint && f.at && Array.isArray(f.unknowns), f.id);
  }
});

test("a moved scope makes exactly the facts under it stale — never the rest, and never false", () => {
  const ctx = bootstrapped();
  ctx.source.write("src/Infrastructure/Data/AppDbContext.cs", `${SHAREPOINT["src/Infrastructure/Data/AppDbContext.cs"]}// x\n`);
  const f = ensureFacts(ctx, []);
  assert.deepEqual(f.usageMoved, ["src/Infrastructure", "src/Infrastructure/Data/AppDbContext.cs"], "the file, and the unit a new file would land in");
  assert.equal(f.scopes["src/Infrastructure/SharePoint/CsomListService.cs"].state, "fresh");
  assert.equal(f.scopes["src/Infrastructure/DependencyInjection.cs"].state, "fresh", "a sibling directory's change moves nothing scoped to the parent's own files");
});

test("a scope with uncommitted edits is unknown, and the fact recorded over it is not claimed fresh", () => {
  const ctx = world(SHAREPOINT, dotnetRegistry(), { dirty: ["src/Infrastructure/Caching/RedisCacheLock.cs"] });
  ensured(ctx);
  const redis = byKey(ctx, "usage", "redis:redis:?@src/Infrastructure/Caching");
  assert.equal(redis.status, "unknown");
  assert.equal(byKey(ctx, "usage", "sharepoint-csom:sharepoint:lists@src/Infrastructure/SharePoint").status, "fresh");
});

test("confidence is carried from the evidence: a client named without its namespace is only possible", () => {
  const ctx = world({ "A.csproj": references("Microsoft.Graph"), "src/B.cs": "class B { GraphServiceClient c; }" }, dotnetRegistry());
  ensured(ctx);
  assert.equal(ctx.intel.all().find((f) => f.kind === "usage").confidence, "possible");
});

test("no checkout at all is BLOCKED, and nothing is written", () => {
  const ctx = world(SHAREPOINT, dotnetRegistry());
  const gone = { ...ctx, source: { ...ctx.source, commit: () => null } };
  assert.throws(() => ensured(gone), /no readable git checkout/);
  assert.deepEqual([...ctx.io.files.keys()], []);
});
