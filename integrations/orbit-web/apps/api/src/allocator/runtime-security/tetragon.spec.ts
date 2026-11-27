// THE SENSOR THE OPERATOR RUNS IS THE SENSOR THE CODE WAS PROVEN AGAINST (ADR 0063): docker/compose.runtime-security.yaml
// names the image and the command line a deployment's sensor runs; tetragon.ts names the same for the real-kernel tier.
// A pin moved in one place only would run a sensor nobody tested, or export what was meant to be filtered out at the
// source (a process's arguments), so the two are held equal here.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { TETRAGON_ARGS, TETRAGON_IMAGE } from "./tetragon.js";

const COMPOSE = resolve(import.meta.dirname, "../../../../../../docker/compose.runtime-security.yaml");

// The sensor's service block, read as text: its `image:` and its `command:` list (a value quoted as YAML quotes it).
function sensorService(): { image: string | null; command: string[] } {
  const lines = readFileSync(COMPOSE, "utf8").split("\n");
  const start = lines.indexOf("  orbit-tetragon:");
  const end = lines.findIndex((l, i) => i > start && /^ {2}\S/.test(l));
  const block = lines.slice(start + 1, end === -1 ? undefined : end);
  const image = block.find((l) => l.startsWith("    image: "))?.slice("    image: ".length).trim() ?? null;
  const at = block.indexOf("    command:");
  const command: string[] = [];
  for (const l of block.slice(at + 1)) {
    if (!l.startsWith("      - ")) break;
    command.push(unquote(l.slice("      - ".length)));
  }
  return { image, command: at === -1 ? [] : command };
}

function unquote(v: string): string {
  if (v.startsWith('"')) return JSON.parse(v) as string;
  if (v.startsWith("'")) return v.slice(1, -1).replaceAll("''", "'");
  return v;
}

test("the compose override runs the sensor image the code pins, by digest", () => {
  const { image } = sensorService();
  assert.equal(image, TETRAGON_IMAGE);
  assert.match(TETRAGON_IMAGE, /^quay\.io\/cilium\/tetragon:v\d+\.\d+\.\d+@sha256:[0-9a-f]{64}$/, "a version tag AND a digest, never latest");
});

test("the compose override runs the sensor with the code's command line: no network port, arguments filtered at the source", () => {
  const { command } = sensorService();
  assert.deepEqual(command, [...TETRAGON_ARGS]);
  assert.equal(command[command.indexOf("--health-server-address") + 1], "", "no health port: the sensor has no network");
  assert.match(command[command.indexOf("--field-filters") + 1] ?? "", /process\.arguments,parent\.arguments.*EXCLUDE/);
});
