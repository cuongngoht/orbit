// Project shapes for the runtime tests, and the one way they are read.
//
// A shape is a map of tracked paths to their committed text -- a tiny repository
// -- and `discovered` reads it exactly as a scan does: the built-in ecosystem
// adapters, the shipped catalog, a source tree held in memory that counts what is
// asked of it. Nothing here reaches a disk, a process or a network.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { builtinEcosystems } from "../../src/ecosystems/builtin.mjs";
import { runtimeCatalog } from "../../src/runtime/catalog.mjs";
import { discover } from "../../src/runtime/discover/index.mjs";
import { memorySource } from "./source.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

export const SHIPPED_CATALOG = runtimeCatalog(JSON.parse(readFileSync(join(ROOT, "catalog", "runtimes.json"), "utf8")));

export const SHIPPED_TOOLS = JSON.parse(readFileSync(join(ROOT, "catalog", "tools.json"), "utf8"));

// -> { out: discover()'s answer, source: the memory source, input }
export function discovered(files, opts = {}) {
  const source = opts.source ?? memorySource(files);
  const input = { files: source.files(), read: (p) => source.read(p), ecosystems: opts.ecosystems ?? builtinEcosystems(), catalog: opts.catalog ?? SHIPPED_CATALOG, name: opts.name ?? "shop" };
  return { out: discover(input), source, input };
}

const json = (value) => JSON.stringify(value, null, 2);

const csproj = (target, sdk = "Vendor.NET.Sdk.Web") => `<Project Sdk="${sdk}"><PropertyGroup>${target}</PropertyGroup></Project>`;

const settings = (profiles) => json({ profiles });

// A shared build file: a project with no SDK of its own, imported into every project beneath it.
const sharedBuild = (properties) => `<Project><PropertyGroup>${properties}</PropertyGroup></Project>`;

const WORKFLOW = `name: ci
on: push
jobs:
  test:
    runs-on: \${{ matrix.os }}
    strategy:
      matrix:
        os: [ubuntu-latest, windows-latest]
    steps:
      - run: make test
`;

// A React client and a modern .NET API, no dev container -- Scenario A.
export const NODE_AND_DOTNET = {
  "web/package.json": json({ name: "web", engines: { node: ">=22" }, scripts: { dev: "vite", build: "vite build", lint: "eslint .", deploy: "./ship.sh", test: "vitest run" }, devDependencies: { "@playwright/test": "1.50.0" } }),
  "web/package-lock.json": "{}",
  "api/Api.csproj": csproj("<TargetFramework>net8.0</TargetFramework>"),
  "api/Properties/launchSettings.json": settings({ http: { commandName: "Project", applicationUrl: "http://localhost:5000" }, "IIS Express": { commandName: "IISExpress" } }),
  "tests/Api.Tests/Api.Tests.csproj": csproj("<TargetFramework>net8.0</TargetFramework><IsTestProject>true</IsTestProject>", "Vendor.NET.Sdk"),
  ".github/workflows/ci.yml": WORKFLOW,
};

// A classic Windows backend beside a React client -- Scenario F.
export const FRAMEWORK_BACKEND = {
  "web/package.json": json({ name: "web", engines: { node: ">=22" }, scripts: { dev: "vite" } }),
  "web/package-lock.json": "{}",
  "legacy/Legacy.csproj": csproj("<TargetFrameworkVersion>v4.8</TargetFrameworkVersion>", "Vendor.NET.Sdk"),
  "legacy/Properties/launchSettings.json": settings({ Legacy: { commandName: "Project", applicationUrl: "http://localhost:8081" } }),
};

// Nothing an ecosystem adapter reads: a Makefile, a Dockerfile, a README -- Scenario E.
export const UNKNOWN_STACK = {
  Makefile: "build:\n\t./compile.sh\n\ntest: build\n\t./check.sh\n\nrun:\n\t./bin/server\n\nclean:\n\trm -rf out\n\n.PHONY: build test run clean\n",
  Dockerfile: "FROM ubuntu:24.04\nEXPOSE 8080\nCMD [\"./bin/server\"]\n",
  "README.md": "# custom\n\nRun `make run`.\n",
};

// The polyglot shape of Scenario D: a Node client, a Python worker, two servers.
export const POLYGLOT = {
  "web/package.json": json({ name: "web", engines: { node: ">=22" }, scripts: { dev: "vite" }, devDependencies: { "@playwright/test": "1" } }),
  "web/package-lock.json": "{}",
  "worker/.python-version": "3.13\n",
  "worker/Makefile": "run:\n\tpython main.py\n",
  "docker-compose.yml": "services:\n  db:\n    image: postgres:16\n    ports:\n      - \"5432:5432\"\n  cache:\n    image: redis:7\n  app:\n    build: .\n",
};

export const DEVCONTAINER_JSONC = `// the shop's dev container
{
  "name": "shop",
  "image": "mcr.microsoft.com/devcontainers/base:ubuntu",
  "features": {
    // pinned: CI runs 20
    "ghcr.io/devcontainers/features/node:1": { "version": "20" },
    "ghcr.io/devcontainers/features/dotnet:2": { "version": "8.0" }
  },
  "forwardPorts": [5173, 5000],
  "appPort": [5000],
  "remoteEnv": { "API_TOKEN": "do-not-keep-this-value" },
  "postCreateCommand": "npm ci && dotnet restore",
}
`;

// ---- worlds: what the resolver is asked about ---------------------------------------------

import { componentsOf } from "../../src/runtime/components.mjs";
import { makeFact } from "../../src/runtime/model.mjs";

export const CHECKOUT_ID = "c".repeat(64);

// The facts of a project as stored: stamped, so they have ids and a checkout.
export const factsOf = (files, opts) => discovered(files, opts).out.facts.map((f) => makeFact(f, { checkout: CHECKOUT_ID, commit: "abc1234", status: "fresh" }));

export const viewOf = (files, opts) => componentsOf(factsOf(files, opts));

// A machine: `tools` maps a tool id to the version it answers (AVAILABLE), to
// `false` (UNAVAILABLE), or to `{ reason }`; a tool not named is UNKNOWN -- nobody
// asked.
export function machineOf(platform, tools = {}) {
  const state = (v) => (typeof v === "string" ? { state: "AVAILABLE", version: v, reason: null } : v === false ? { state: "UNAVAILABLE", version: null, reason: null } : v && typeof v === "object" ? { state: "UNAVAILABLE", version: null, ...v } : { state: "UNKNOWN", version: null, reason: null });
  return { platform, arch: "arm64", tools: new Proxy(Object.fromEntries(Object.entries(tools).map(([id, v]) => [id, state(v)])), { get: (t, id) => t[id] ?? state(undefined) }) };
}

export const FULL_TOOLS = { node: "22.1.0", npm: "10.8.1", dotnet: "8.0.100", python3: "3.13.1", make: "4.3", docker: "27.3.1", "docker-daemon": "27.3.1", devcontainer: "0.71.0" };

export function worldOf(files, opts = {}) {
  const view = opts.view ?? viewOf(files, opts);
  return { view, machine: opts.machine ?? machineOf(opts.platform ?? "darwin", opts.tools ?? FULL_TOOLS), catalog: SHIPPED_CATALOG, instances: opts.instances ?? [], checkout: CHECKOUT_ID, envId: "env-test", reach: opts.reach ?? {} };
}

// A backend whose projects inherit their target from a shared build file -- the way a monorepo says it
// once. `Api` sets none (so it takes the shared one), `Worker` sets its own, `Old` sits under a nearer
// shared file that names a classic framework, and a Node tool sits in the same folder tree and is
// nobody's to inherit from.
export const SHARED_TARGETS = {
  "backend/Directory.Build.props": sharedBuild("<TargetFramework>net10.0</TargetFramework>"),
  "backend/Api/Api.csproj": csproj("<Nullable>enable</Nullable>"),
  "backend/Api/Properties/launchSettings.json": settings({ http: { commandName: "Project", applicationUrl: "http://localhost:5100" } }),
  "backend/Worker/Worker.csproj": csproj("<TargetFramework>net8.0</TargetFramework>", "Vendor.NET.Sdk.Worker"),
  "backend/Legacy/Directory.Build.props": sharedBuild("<TargetFrameworkVersion>v4.8</TargetFrameworkVersion>"),
  "backend/Legacy/Old/Old.csproj": csproj("<RootNamespace>Old</RootNamespace>", "Vendor.NET.Sdk"),
  "backend/tools/web/package.json": json({ name: "tools-web", scripts: { dev: "vite" } }),
  "backend/tools/web/package-lock.json": "{}",
};
