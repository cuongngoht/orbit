// The runtime subject names no stack, no product and no vendor, imports nothing it may
// not, and touches no machine except through a port -- held by grep, the way the
// knowledge and requirements subjects hold themselves, because a rule that is only
// written down is a rule one convenient import away from being false.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const RUNTIME = join(ROOT, "src", "runtime");

const walk = (dir) => readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? walk(join(dir, n)) : [join(dir, n)]));
const files = walk(RUNTIME).filter((p) => p.endsWith(".mjs"));
const code = (p) => readFileSync(p, "utf8").split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");

// A stack, a package manager, a framework, a database, a vendor: product knowledge, which is
// catalog data (catalog/runtimes.json) or an ecosystem adapter's (src/ecosystems/), and never
// this subject's. `docker`, `devcontainer` and `compose` are the ENVIRONMENT mechanism this
// subject exists to design, and are not on the list; `make`, `task` and `just` are the build
// FILE formats the generic fallback reads.
const PRODUCTS = /\b(npm|pnpm|yarn|nodejs?|dotnet|nuget|csproj|msbuild|python3?|pip|java|golang|ruby|rustc|cargo|maven|gradle|postgres(ql)?|redis|kafka|rabbitmq|mongo(db)?|mysql|mariadb|sql ?server|playwright|github|gitlab|azure|aws|vscode|microsoft|jetbrains|kubernetes|terraform)\b/i;

test("nothing under src/runtime names a stack, a package manager, a database or a vendor -- code and strings, not only comments", () => {
  const hits = files.flatMap((p) => code(p).split("\n").map((l, i) => [relative(ROOT, p), i + 1, l]).filter(([, , l]) => PRODUCTS.test(l)).map(([f, n, l]) => `${f}:${n}  ${l.trim().slice(0, 100)}`));
  assert.deepEqual(hits, []);
});

// What the runtime subject may import: leaves, the ports it is handed, the one shared
// semver subset, and its own files. Every other subsystem is reached through `cli/` or a
// binding, never from here. `version.mjs` is the leaf that says which engine this is -- what
// reads a checkout's evidence is printed with it, so an upgrade reads again.
const ALLOWED = /^(errors|hash|constraints|scrub|freshness|catalog|runtime|ecosystems|frontend|process|probe|project|store|tools)\//;
const SINGLE = new Set(["errors.mjs", "hash.mjs", "constraints.mjs", "scrub.mjs", "freshness.mjs", "catalog.mjs", "version.mjs", "extensions/engine-range.mjs", "learn/args.mjs"]);

test("src/runtime imports only leaves, ports and itself -- never another subject, and never the engine's extensions beyond one pure semver file", () => {
  const bad = [];
  for (const p of files) {
    for (const m of code(p).matchAll(/from\s+"(\.[^"]+)"/g)) {
      const target = relative(join(ROOT, "src"), resolve(dirname(p), m[1])).replace(/\\/g, "/");
      if (!SINGLE.has(target) && !ALLOWED.test(target)) bad.push(`${relative(ROOT, p)} imports ${target}`);
    }
  }
  assert.deepEqual(bad, []);
});

test("it spawns nothing, opens no socket and reads no file or environment of its own: every effect goes through a port it is handed", () => {
  const forbidden = /(from\s+"node:(child_process|net|http|https|fs|os|dgram|worker_threads)")|\bprocess\.(env|cwd|platform|argv|exit|kill)\b|\bfetch\(|\bchild_process\b/;
  const hits = files.flatMap((p) => code(p).split("\n").map((l, i) => [relative(ROOT, p), i + 1, l]).filter(([, , l]) => forbidden.test(l)).map(([f, n, l]) => `${f}:${n}  ${l.trim().slice(0, 80)}`));
  assert.deepEqual(hits, []);
});

test("only a composition root -- a CLI, a skill's binding, Orbit Control -- imports the runtime subject: nothing in src/ reaches up into it", () => {
  const importers = [];
  for (const dir of ["src", "skills", "cli", "control-server/src"]) {
    for (const p of walk(join(ROOT, dir)).filter((f) => f.endsWith(".mjs") && !f.startsWith(RUNTIME))) {
      const reaches = [...readFileSync(p, "utf8").matchAll(/from\s+"(\.[^"]+)"/g)].some((m) => resolve(dirname(p), m[1]).startsWith(`${RUNTIME}${sep}`));
      if (reaches) importers.push(relative(ROOT, p).replace(/\\/g, "/"));
    }
  }
  assert.deepEqual(importers.filter((p) => !/^(skills|cli|control-server)\//.test(p)), [], "nothing in src/ imports the runtime subject");
  assert.ok(importers.includes("cli/runtime.mjs") && importers.includes("skills/orbit-runtime/bind.mjs"));
});

test("the catalog is where the words live: every requirement, launcher and runner it names is data, and the code reads none by name", () => {
  const catalog = JSON.parse(readFileSync(join(ROOT, "catalog", "runtimes.json"), "utf8"));
  assert.ok(catalog.requirements.some((r) => r.id === "dotnet-framework"), "the classic framework is DATA, not a branch");
  assert.ok(catalog.launchers.length && catalog.scripts.length && catalog.services.length);
});
