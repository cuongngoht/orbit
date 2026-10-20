// The runtime catalog is data, read defensively and asked a handful of questions.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { byDependency, byImage, impliedBy, launcherFor, pipelineFile, platformOfRunner, primitiveArgv, requirement, runtimeCatalog, scriptFile, serviceByImage, tagOf, versionFile } from "../src/runtime/catalog.mjs";

const SHIPPED = runtimeCatalog(JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "catalog", "runtimes.json"), "utf8")));

test("the shipped catalog holds every section, and every requirement names a tool that exists in the tool catalog", () => {
  const tools = new Set(JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "catalog", "tools.json"), "utf8")).tools.map((t) => t.id));
  assert.ok(SHIPPED.requirements.length >= 10 && SHIPPED.services.length >= 4 && SHIPPED.scripts.length === 3 && SHIPPED.ci.runners.length === 3 && SHIPPED.launchers.length >= 2);
  for (const r of SHIPPED.requirements.filter((x) => x.tool)) assert.ok(tools.has(r.tool), `${r.id} names the tool ${r.tool}, which catalog/tools.json does not have`);
  for (const l of SHIPPED.launchers.flatMap((x) => x.via).filter((v) => v.requires)) assert.ok(requirement(SHIPPED, l.requires), `${l.requires} is a runner nobody defined`);
});

test("the classic framework is a requirement of its own: Windows only, and no Linux container provides it", () => {
  const classic = requirement(SHIPPED, "dotnet-framework");
  assert.deepEqual([classic.os, classic.container, classic.feature, classic.tool], [["win32"], false, null, null]);
  assert.equal(requirement(SHIPPED, "dotnet").os, null);
  assert.equal(requirement(SHIPPED, "dotnet").feature.id, "ghcr.io/devcontainers/features/dotnet");
});

test("an image maps to a requirement or a service by its NAME, never by a prefix of another name", () => {
  assert.equal(byImage(SHIPPED, "node:22-alpine").id, "node");
  assert.equal(byImage(SHIPPED, "mcr.microsoft.com/dotnet/aspnet:8.0").id, "dotnet");
  assert.equal(byImage(SHIPPED, "mcr.microsoft.com/dotnet:8.0"), null, "a name that is not an image of the family is not guessed into it");
  assert.equal(byImage(SHIPPED, "nodemon:1"), null);
  assert.equal(serviceByImage(SHIPPED, "postgres:16").id, "postgres");
  assert.equal(serviceByImage(SHIPPED, "docker.io/library/redis"), null, "a registry host in front is not guessed away");
  assert.equal(serviceByImage(SHIPPED, "REDIS:7@sha256:abc").id, "redis");
});

test("a tag is a version only when it is one: 22, 3.13, 8.0.1 -- and 22-alpine counts, bookworm does not", () => {
  assert.deepEqual(["node:22", "python:3.13", "x:8.0.1", "node:22-alpine", "node:bookworm", "node", "node:latest", "node@sha256:abc", "d/dotnet:8.0-bookworm", "d/dotnet:1-8.0-bookworm"].map(tagOf), ["22", "3.13", "8.0.1", "22", null, null, null, null, "8.0", null]);
});

test("a dependency name implies the requirement whose row lists it", () => {
  assert.deepEqual(byDependency(SHIPPED, "@playwright/test").map((r) => r.id), ["playwright"]);
  assert.deepEqual(byDependency(SHIPPED, "left-pad"), []);
});

test("version files, script files and pipelines are found by name", () => {
  assert.equal(versionFile(SHIPPED, "apps/web/.nvmrc").requirement, "node");
  assert.equal(versionFile(SHIPPED, ".tool-versions").format, "pairs");
  assert.equal(versionFile(SHIPPED, "README.md"), null);
  assert.deepEqual(["Makefile", "sub/GNUmakefile", "Taskfile.yml", "justfile", "README.md"].map((p) => scriptFile(SHIPPED, p)?.format ?? null), ["makefile", "makefile", "taskfile", "justfile", null]);
  assert.deepEqual([".github/workflows/ci.yml", ".github/workflows/x.yaml", ".github/workflows/sub/x.yml", "ci.yml"].map((p) => pipelineFile(SHIPPED, p)), [true, true, false, false]);
  assert.deepEqual(["ubuntu-24.04", "windows-latest", "macos-14", "self-hosted", "${{ matrix.os }}"].map((l) => platformOfRunner(SHIPPED, l)), ["linux", "win32", "darwin", null, null]);
});

test("how a declared command is RUN: a script ecosystem needs a runner the tree evidences, another is run as written", () => {
  const has = (...files) => (p) => files.includes(p);
  assert.deepEqual(launcherFor(SHIPPED, "node", "apps/web", has("package-lock.json")).via.argv, ["npm", "run", "{name}"]);
  assert.deepEqual(launcherFor(SHIPPED, "node", "apps/web", has("pnpm-lock.yaml", "package-lock.json")).via.requires, "pnpm", "the first row that matches wins, and pnpm is listed first");
  assert.equal(launcherFor(SHIPPED, "node", "apps/web/deep", has("apps/web/yarn.lock")).via.requires, "yarn", "a lock file above the unit serves it");
  const none = launcherFor(SHIPPED, "node", "apps/web", has());
  assert.equal(none.via, null);
  assert.match(none.why, /nothing in the tree says which tool runs them/);
  assert.deepEqual(launcherFor(SHIPPED, "dotnet", "api", has()), { mode: "line", via: null });
  assert.deepEqual(impliedBy(SHIPPED, "dotnet", "test").argv, ["dotnet", "test"]);
  assert.equal(impliedBy(SHIPPED, "dotnet", "web"), null);
});

test("a malformed catalog costs its bad rows, not the others, and never throws", () => {
  const cat = runtimeCatalog({ requirements: [{ id: "ok", tool: "x" }, { id: "Bad Id" }, { nope: 1 }, null], scripts: [{ file: "(", format: "x", runner: "y" }, { file: "^a$", format: "f", runner: "r" }], ci: { files: ["(", "^ok$"], runners: [{ match: "(", os: "linux" }, { match: "^w", os: "win32" }] }, services: [{ id: "s", ports: [1, "x"] }] });
  assert.deepEqual(cat.requirements.map((r) => r.id), ["ok"]);
  assert.equal(cat.scripts.length, 1);
  assert.deepEqual([cat.ci.files.length, cat.ci.runners.length], [1, 1]);
  assert.deepEqual(cat.services[0].ports, [1]);
  assert.deepEqual(runtimeCatalog(null).requirements, []);
});

test("a reach primitive's placeholders are WHOLE argument elements, replaced by the value as an element of its own -- a row that hides one inside a script is dropped", () => {
  const shipped = SHIPPED.connectivity.primitives;
  assert.deepEqual(shipped.map((p) => p.tool), ["node", "python3", "bash"]);
  for (const p of shipped) assert.ok(p.argv.includes("${HOST}") && p.argv.includes("${PORT}") && p.argv.includes("${TIMEOUT_MS}"), p.tool);
  const hostile = "db; rm -rf / #";
  const argv = primitiveArgv(shipped[2], { "${HOST}": hostile, "${PORT}": 5432, "${TIMEOUT_MS}": 3000 });
  assert.deepEqual(argv.slice(-3), [hostile, "5432", "3000"], "a value is one argument");
  assert.equal(argv[2], shipped[2].argv[2], "and the script itself is untouched");
  const odd = runtimeCatalog({ connectivity: { primitives: [{ id: "sh", argv: ["sh", "-c", "nc -z ${HOST} ${PORT}"] }, { id: "nc", argv: ["nc", "-z", "${HOST}"] }, { id: "ok", argv: ["ok", "${HOST}", "${PORT}"] }] } }).connectivity.primitives;
  assert.deepEqual(odd.map((p) => p.tool), ["ok"], "spliced into a script, or asking about no port: dropped");
  assert.deepEqual(runtimeCatalog({}).connectivity.primitives, []);
});
