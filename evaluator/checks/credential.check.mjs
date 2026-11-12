// The credential scan: a room that holds the credential in any spelling is not kept, and nothing is ever printed of it.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { credentialValues, leaksIn, scrubbedRoom, spellingsOf } from "../lib/core/credential.mjs";

const SECRET = "sk-test-0123456789abcdef/+=";

function room() {
  const dir = mkdtempSync(join(tmpdir(), "evl-c-"));
  mkdirSync(join(dir, "out"));
  writeFileSync(join(dir, "clean.txt"), "nothing here");
  writeFileSync(join(dir, "stream.jsonl"), `{"echo":"${SECRET}"}`);
  writeFileSync(join(dir, "out", "b64.txt"), Buffer.from(SECRET).toString("base64"));
  writeFileSync(join(dir, "out", "url.txt"), `token=${encodeURIComponent(SECRET)}`);
  writeFileSync(join(dir, "bin.dat"), Buffer.concat([Buffer.from([0, 255, 1]), Buffer.from(SECRET), Buffer.from([0])]));
  return dir;
}

test("every spelling is found, binary files too, and only the files that hold it", () => {
  const dir = room();
  try {
    assert.deepEqual(leaksIn(dir, [SECRET]).sort(), ["bin.dat", "out/b64.txt", "out/url.txt", "stream.jsonl"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a room that holds it keeps none of those files, and keeps the rest", () => {
  const dir = room();
  try {
    const r = scrubbedRoom(dir, [SECRET]);
    assert.equal(r.leaked.length, 4);
    assert.equal(existsSync(join(dir, "stream.jsonl")), false);
    assert.equal(existsSync(join(dir, "clean.txt")), true);
    assert.deepEqual(leaksIn(dir, [SECRET]), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a link is never followed, and a short or missing value scans nothing", () => {
  const dir = room();
  const outside = mkdtempSync(join(tmpdir(), "evl-o-"));
  try {
    writeFileSync(join(outside, "x"), SECRET);
    symlinkSync(join(outside, "x"), join(dir, "link"));
    assert.ok(!leaksIn(dir, [SECRET]).includes("link"));
    assert.deepEqual(spellingsOf("short"), []);
    assert.deepEqual(leaksIn(dir, []), []);
    assert.deepEqual(credentialValues(["A", "B"], { A: SECRET, B: "x" }), [SECRET]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});
