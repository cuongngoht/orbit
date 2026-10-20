import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { resolveHost, resolveHookHost } from "../skills/orbit-learn/hosts/index.mjs";
import { lifecycleEvent } from "../src/lifecycle/event.mjs";

for (const family of ["claude"]) {
  const root = new URL(`./fixtures/hooks/${family}/`, import.meta.url);
  for (const file of readdirSync(root)) test(`${family} native ${file}`, () => {
    const { input, argv, expected } = JSON.parse(readFileSync(new URL(file, root)));
    assert.deepEqual(lifecycleEvent(resolveHost(input, argv), input, argv), expected);
  });
}

// Protocol v2 payloads are sanitized LIVE captures (Codex 0.157.1, AGY CLI 1.2.12 and 1.4.2, Grok Build 1.0.62),
// resolved the way the hook resolves them: explicitly, never by payload shape.
for (const family of ["codex-v2", "antigravity-v2", "grok-v2"]) {
  const root = new URL(`./fixtures/hooks/${family}/`, import.meta.url);
  for (const file of readdirSync(root)) test(`${family} native ${file}`, async () => {
    const { input, argv, expected } = JSON.parse(readFileSync(new URL(file, root)));
    assert.deepEqual(lifecycleEvent(await resolveHookHost(input, argv), input, argv), expected);
  });
}

