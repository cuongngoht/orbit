// The virtual office's layering, held by reading its sources: a `domain/` file is pure TypeScript (no Nest, no pg, no
// fs, no HTTP -- only the contracts, governance-core and other domain files), and no context reaches into another's
// `presentation/` (the shared kernel's helpers excepted).
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";

const ROOT = join(process.cwd(), "src", "contexts");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return files(p);
    return p.endsWith(".ts") && !p.endsWith(".spec.ts") ? [p] : [];
  });
}

const importsOf = (path: string): string[] => [...readFileSync(path, "utf8").matchAll(/^import[^;]*?from\s+"([^"]+)"/gms)].map((m) => m[1] as string);

test("a domain file imports nothing but the contracts, governance-core and other domain code", () => {
  const offenders: string[] = [];
  for (const f of files(ROOT).filter((p) => /[/\\]domain[/\\]/.test(p))) {
    for (const i of importsOf(f)) {
      const ok = i === "@orbit-web/contracts" || i === "@orbit-web/governance-core" || (i.startsWith(".") && (i.includes("/domain") || i.startsWith("./") || i === "../../shared/domain.js"));
      if (!ok || /node:|@nestjs|\bpg\b|express/.test(i)) offenders.push(`${relative(ROOT, f)} imports ${i}`);
    }
  }
  assert.deepEqual(offenders, []);
});

test("no context imports another context's presentation layer", () => {
  const offenders: string[] = [];
  for (const f of files(ROOT)) {
    const own = relative(ROOT, f).split(/[/\\]/)[0];
    for (const i of importsOf(f)) {
      const m = /\.\.\/\.\.\/([a-z-]+)\/presentation\//.exec(i);
      if (m !== null && m[1] !== own && m[1] !== "shared") offenders.push(`${relative(ROOT, f)} imports ${i}`);
    }
  }
  assert.deepEqual(offenders, []);
});
