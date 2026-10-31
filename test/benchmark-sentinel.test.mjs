// The benchmark's sentinel: after a run, the credential handed to the runner is looked for in every file of the run's
// own room, in every spelling the engine's masking knows, and a file that holds it is rewritten masked -- byte for byte
// otherwise -- while a link is never followed, a file outside the room is never touched, and what the controller made
// from the developer's own files (the subject checkout, the frozen case) is not rewritten.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { leaksMasked } from "../benchmark/lib/sentinel.mjs";

const VALUE = "sentinel-value-0123456789";

function room(t) {
  const base = mkdtempSync(join(tmpdir(), "orbit-bench-sentinel-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const dir = join(base, "bnr-0123456789ab");
  for (const d of ["runner-store/p/workspaces/tsk-1/tree", "rounds/1/out", "checkout", "steps"]) mkdirSync(join(dir, d), { recursive: true });
  return { base, dir };
}

test("the credential is found as typed, in base64 and percent-encoded, and masked where it was -- the rest of each file kept byte for byte", (t) => {
  const { base, dir } = room(t);
  const binary = Buffer.concat([Buffer.from([0, 255, 254, 10]), Buffer.from(`k=${VALUE};`), Buffer.from([0, 1])]);
  writeFileSync(join(dir, "runner-store/p/workspaces/tsk-1/tree/env.txt"), `ANTHROPIC_API_KEY=${VALUE}\n`);
  writeFileSync(join(dir, "rounds/1/out/host.jsonl"), `{"auth":"${Buffer.from(VALUE).toString("base64")}"}\n`);
  writeFileSync(join(dir, "steps/act-3.json"), `{"url":"x?k=${encodeURIComponent(VALUE)}"}`);
  writeFileSync(join(dir, "rounds/1/out/blob.bin"), binary);
  writeFileSync(join(dir, "rounds/1/out/clean.txt"), "nothing here\n");
  writeFileSync(join(dir, "checkout/README.md"), `a value the developer's own source holds: ${VALUE}\n`);
  writeFileSync(join(base, "outside.txt"), VALUE);
  symlinkSync(join(base, "outside.txt"), join(dir, "rounds/1/out/link.txt"));
  const found = leaksMasked(dir, [VALUE, undefined, "short"]);
  assert.deepEqual(found.map((f) => [f.rel, f.done]).sort(), [["rounds/1/out/blob.bin", "masked"], ["rounds/1/out/host.jsonl", "masked"], ["runner-store/p/workspaces/tsk-1/tree/env.txt", "masked"], ["steps/act-3.json", "masked"]]);
  assert.equal(readFileSync(join(dir, "runner-store/p/workspaces/tsk-1/tree/env.txt"), "utf8"), "ANTHROPIC_API_KEY=[redacted]\n");
  assert.deepEqual(readFileSync(join(dir, "rounds/1/out/blob.bin")), Buffer.concat([Buffer.from([0, 255, 254, 10]), Buffer.from("k=[redacted];"), Buffer.from([0, 1])]), "a file that is not text keeps every other byte");
  assert.equal(readFileSync(join(base, "outside.txt"), "utf8"), VALUE, "a link is never followed, and nothing outside the room is touched");
  assert.match(readFileSync(join(dir, "checkout/README.md"), "utf8"), new RegExp(VALUE), "the controller's own copy of the developer's files is not the sentinel's to rewrite");
  assert.deepEqual(leaksMasked(dir, [VALUE]), [], "a second look finds nothing");
});

test("no credential handed, nothing read", (t) => {
  const { dir } = room(t);
  writeFileSync(join(dir, "steps/act-1.json"), "{}");
  assert.deepEqual(leaksMasked(dir, []), []);
  assert.deepEqual(leaksMasked(dir, [undefined, "", "1234567"]), [], "a value too short to be a credential would mask ordinary words");
});
