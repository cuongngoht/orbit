import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { DECISIONS, STEPS, resolve } from "../src/intelligence/resolution/resolve.mjs";
import { resolveView, worldOf } from "../src/intelligence/views/resolve.mjs";
import { dotnetRegistry, references } from "./fakes/dotnet.mjs";
import { captured, ensured, world } from "./fakes/intelligence.mjs";
import { SHAREPOINT } from "./fixtures/intelligence/sharepoint.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function worldFor(files, extra = {}) {
  const ctx = world(files, dotnetRegistry());
  ensured(ctx);
  return { ...worldOf(ctx), ...extra };
}

const cap = (id) => ({ id, doc: "d", from: "project extension x" });

// ---- the brief's two examples ----

test("Example A: Graph + CSOM, CSOM does lists, sharepoint.list.get exists -> reuse it, on CSOM", () => {
  const a = resolve("read-sharepoint-list", worldFor(SHAREPOINT, { capabilities: [cap("sharepoint.list.get"), cap("sharepoint.file.upload")] }));
  assert.equal(a.decision, "reuse");
  assert.equal(a.capability, "sharepoint.list.get");
  assert.equal(a.technology, "sharepoint-csom");
  assert.deepEqual([a.integration, a.operation], ["sharepoint", "lists"]);
  assert.ok(a.evidence.includes("src/Infrastructure/SharePoint/CsomListService.cs"));
  assert.ok(a.unknowns.some((u) => /whether sharepoint\.list\.get is built on sharepoint-csom/.test(u)));
});

test("Example B: Npgsql declared, no postgres capability -> build, on PostgreSQL, because the capability is missing", () => {
  const w = worldFor({ "src/Data/Data.csproj": references("Npgsql"), "src/Data/OrderRepository.cs": "class OrderRepository { }" });
  const b = resolve("query PostgreSQL", w);
  assert.equal(b.decision, "build");
  assert.equal(b.technology, "postgresql");
  assert.match(b.reason, /^required execution capability is missing/);
  assert.equal(b.capability, undefined);
  assert.match(b.next, /Nothing was generated or registered/);
  assert.equal(resolve("query PostgreSQL", { ...w, capabilities: [cap("postgres.query")] }).decision, "reuse", "an alias names the same system");
});

// ---- precedence ----

test("an existing implementation beats every technology that merely COULD do it", () => {
  const w = worldFor(SHAREPOINT);
  assert.equal(resolve("upload a sharepoint file", w).technology, "microsoft-graph");
  assert.equal(resolve("read sharepoint list items", w).technology, "sharepoint-csom");
  assert.equal(resolve("upload a sharepoint file", w).considered[0].verdict, "settled", "the first step settled it");
});

test("the system alone, done two ways, is UNKNOWN — never 'SharePoint means Graph'", () => {
  const a = resolve("sharepoint", worldFor(SHAREPOINT));
  assert.equal(a.decision, "unknown");
  assert.match(a.reason, /microsoft-graph and sharepoint-csom/);
  assert.equal(a.technology, undefined);
});

test("two declared technologies that could serve an operation nobody implemented is UNKNOWN", () => {
  const a = resolve("read sharepoint site", worldFor(SHAREPOINT));
  assert.equal(a.decision, "unknown");
  assert.deepEqual(a.considered.map((c) => [c.step, c.verdict]), [["implementation", "pass"], ["convention", "pass"], ["technology", "ambiguous"]]);
});

test("an adopted convention settles what the code alone cannot", () => {
  const conventions = [{ id: "eng-convention-sites", key: "sharepoint-sites-via-csom", statement: "SharePoint sites are read with CSOM", strength: "adopted", evidence: ["src/Infrastructure/SharePoint/CsomListService.cs"] }];
  const a = resolve("read sharepoint site", worldFor(SHAREPOINT, { conventions }));
  assert.deepEqual([a.decision, a.technology], ["build", "sharepoint-csom"]);
  assert.match(a.reason, /the project's own convention says sharepoint-csom \(eng-convention-sites\)/);
});

test("catalog knowledge alone never chooses: UNKNOWN, with the options", () => {
  const a = resolve("publish kafka messages", worldFor(SHAREPOINT));
  assert.equal(a.decision, "unknown");
  assert.deepEqual(a.options, ["kafka"]);
  assert.match(a.reason, /choosing one is this project's decision/);
});

test("no snapshot is BLOCKED, and an intent naming nothing known is UNKNOWN", () => {
  assert.equal(resolve("read sharepoint list", { ...worldFor(SHAREPOINT), snapshot: false }).decision, "blocked");
  const nothing = resolve("frobnicate the widget", worldFor(SHAREPOINT));
  assert.equal(nothing.decision, "unknown");
  assert.match(nothing.reason, /names no system anything here knows — asked about frobnicate, widget/);
});

test("every decision explains itself: a reason, every step it considered, and what it could not settle", () => {
  const w = worldFor(SHAREPOINT, { capabilities: [cap("sharepoint.list.get")] });
  for (const intent of ["read sharepoint list", "query postgresql", "sharepoint", "publish kafka messages", "frobnicate"]) {
    const a = resolve(intent, w);
    assert.ok(a.reason, intent);
    assert.ok(Array.isArray(a.considered) && a.considered.every((c) => c.says), intent);
    assert.ok(Array.isArray(a.unknowns), intent);
    assert.ok(a.next, intent);
  }
});

test("both tables end in a row that always answers", () => {
  assert.equal(DECISIONS.at(-1).when({}), true);
  assert.deepEqual(STEPS.map((s) => s.name), ["implementation", "convention", "technology", "descriptor"]);
});

// ---- it decides, and never acts ----

test("resolving writes nothing, registers nothing and generates nothing", () => {
  const ctx = world(SHAREPOINT, dotnetRegistry());
  ensured(ctx);
  const before = new Map(ctx.io.files);
  const capabilities = [cap("sharepoint.list.get")];
  const ids = ctx.registry.descriptors.ids().length;
  const out = captured(() => resolveView({ ...ctx, capabilities: () => capabilities }, ["read", "sharepoint", "list"]));
  assert.match(out, /RESOLVE {2}reuse/);
  assert.deepEqual(new Map(ctx.io.files), before, "the store moved");
  assert.equal(capabilities.length, 1);
  assert.equal(ctx.registry.descriptors.ids().length, ids);
});

test("nothing in the resolver can write, register, spawn or import a builder", () => {
  const dir = join(ROOT, "src", "intelligence", "resolution");
  for (const f of readdirSync(dir)) assert.doesNotMatch(readFileSync(join(dir, f), "utf8"), /\.register\(|\.save\(|writeFile|child_process|\.setModel\(|from "[^"]*(scaffold|lifecycle|extensions|store)/, `${f} can act, not only decide`);
});

test("--json is the same answer, whole", () => {
  const ctx = world(SHAREPOINT, dotnetRegistry());
  ensured(ctx);
  const json = JSON.parse(captured(() => resolveView(ctx, ["read", "sharepoint", "list", "--json"])));
  assert.deepEqual([json.decision, json.technology], ["build", "sharepoint-csom"]);
});
