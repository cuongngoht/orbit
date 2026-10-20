import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { createSourceTree } from "../src/frontend/composite.mjs";
import { maturityOf } from "../src/intelligence/technology/maturity.mjs";
import { dotnetRegistry, references } from "./fakes/dotnet.mjs";
import { ensured, world } from "./fakes/intelligence.mjs";

// A project spanning checkouts is several technology stories, never one soup.
// The primary keeps plain paths; every other checkout is `<alias>::` -- the
// composite port's language, which the intelligence core reads through
// `splitPath` and never re-invents.

const GRAPH = "using Microsoft.Graph;\nclass Files { GraphServiceClient c; void F() { c.Sites[\"s\"].Drive.GetAsync(); } }";
const BUS = "using Azure.Messaging.ServiceBus;\nclass Handler { ServiceBusProcessor p; }";

const FILES = {
  "src/Api/Api.csproj": references("Microsoft.Graph"),
  "src/Api/Files.cs": GRAPH,
  "worker::src/Api/Api.csproj": references("Azure.Messaging.ServiceBus"),
  "worker::src/Api/Handler.cs": BUS,
  "shared::src/Common/Common.csproj": references("StackExchange.Redis"),
};

const scanned = (files = FILES) => {
  const ctx = world(files, dotnetRegistry());
  ensured(ctx);
  return ctx.intel.all();
};

test("each checkout's technologies stay with that checkout", () => {
  const techs = scanned().filter((f) => f.kind === "technology").map((f) => [f.root, f.technology]).sort();
  assert.deepEqual(techs, [[".", "microsoft-graph"], ["shared", "redis"], ["worker", "azure-service-bus"]]);
});

test("the same relative path in two checkouts is two subjects, and never collides", () => {
  const manifests = scanned().filter((f) => f.kind === "manifest").map((f) => f.key).sort();
  assert.deepEqual(manifests, ["shared::src/Common/Common.csproj", "src/Api/Api.csproj", "worker::src/Api/Api.csproj"]);
  const ids = scanned().map((f) => f.id);
  assert.equal(new Set(ids).size, ids.length);
});

test("usage is gated per checkout: a client declared in one is not searched for in another", () => {
  const files = { ...FILES, "worker::src/Api/Stray.cs": GRAPH };
  const usages = scanned(files).filter((f) => f.kind === "usage").map((f) => [f.root, f.technology]).sort();
  assert.deepEqual(usages, [[".", "microsoft-graph"], ["worker", "azure-service-bus"]], "the worker never declared the Graph client");
});

test("integrations and ladders are per checkout", () => {
  const facts = scanned();
  assert.deepEqual(facts.filter((f) => f.kind === "integration").map((f) => [f.key, f.technologies]).sort(), [["sharepoint:files", ["microsoft-graph"]], ["worker::service-bus:messages", ["azure-service-bus"]]]);
  assert.deepEqual(maturityOf(facts).map((l) => [l.root, l.technology]).sort(), [[".", "microsoft-graph"], ["shared", "redis"], ["worker", "azure-service-bus"]]);
});

test("a change in one checkout re-reads nothing in another", () => {
  const ctx = world(FILES, dotnetRegistry());
  ensured(ctx);
  ctx.source.calls.paths = [];
  ctx.source.write("worker::src/Api/Handler.cs", `${BUS}\n// edited\n`);
  ensured(ctx);
  assert.deepEqual(ctx.source.calls.paths, ["worker::src/Api/Handler.cs"]);
});

// The same through the REAL composite port and real git, once: namespacing,
// search and fingerprints have to agree with the in-memory fake for any of the
// above to mean something.
function repo(name, files) {
  const dir = join(mkdtempSync(join(tmpdir(), "orbit-intel-multi-")), name);
  for (const [p, text] of Object.entries(files)) {
    mkdirSync(join(dir, dirname(p)), { recursive: true });
    writeFileSync(join(dir, p), text);
  }
  for (const args of [["init", "-q", "."], ["add", "-A"], ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "x"]]) spawnSync("git", args, { cwd: dir });
  return dir;
}

test("through the real composite port: a secondary checkout is detected, namespaced and kept apart", () => {
  const backend = repo("backend", { "src/Api/Api.csproj": references("Microsoft.Graph"), "src/Api/Files.cs": GRAPH });
  const worker = repo("worker", { "src/Api/Api.csproj": references("Azure.Messaging.ServiceBus"), "src/Api/Handler.cs": BUS });
  const ctx = world({}, dotnetRegistry(), { source: createSourceTree([backend, worker]) });
  ensured(ctx);
  const usages = ctx.intel.all().filter((f) => f.kind === "usage").map((f) => [f.root, f.technology, f.evidence[0], f.status]).sort();
  assert.deepEqual(usages, [[".", "microsoft-graph", "src/Api/Files.cs", "fresh"], ["worker", "azure-service-bus", "worker::src/Api/Handler.cs", "fresh"]]);
  assert.match(ensured(ctx), /INTELLIGENCE CURRENT/, "fingerprints through the composite settle freshness");
});
