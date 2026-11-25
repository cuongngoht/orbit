import assert from "node:assert/strict";
import { test } from "node:test";
import { ENVIRONMENT_HERE, environmentFor, parseDefaults } from "./auto-mode.js";

const DEFAULTS = [
  "**Organization**: None configured",
  "**Network posture**: None configured",
  "**Host containment**: None configured — assume an ordinary developer machine",
  "**Sensitive data locations & audiences**: any file or store holding credentials",
];

test("the CLI's own environment is kept, and only what is true of this place replaces its two entries", () => {
  const env = environmentFor(DEFAULTS);
  assert.equal(env.length, DEFAULTS.length);
  assert.equal(env[0], DEFAULTS[0]);
  assert.equal(env[3], DEFAULTS[3], "what protects sensitive data stays as the CLI says it");
  assert.equal(env[1], `**Network posture**: ${ENVIRONMENT_HERE["Network posture"]}`);
  assert.equal(env[2], `**Host containment**: ${ENVIRONMENT_HERE["Host containment"]}`);
  assert.match(env[1] as string, /open internet/i);
  assert.match(env[1] as string, /credential/i, "sending a credential out is still not ordinary work");
  assert.match(env[1] as string, /webhook|request-capture/i, "probing endpoints unrelated to the task stays reconnaissance");
  assert.doesNotMatch(env[1] as string, /\bcurl\b|\bwget\b/, "no tool is named as ordinary: what is fetched, and why, is");
});

test("an entry the CLI no longer lists is added, never lost", () => {
  const env = environmentFor(["**Organization**: None configured"]);
  assert.deepEqual(env.slice(1), [`**Network posture**: ${ENVIRONMENT_HERE["Network posture"]}`, `**Host containment**: ${ENVIRONMENT_HERE["Host containment"]}`]);
});

test("the defaults are read from the CLI's JSON; anything else is no environment at all (the CLI's own then stand)", () => {
  assert.deepEqual(parseDefaults(JSON.stringify({ environment: DEFAULTS, allow: [] })), DEFAULTS);
  for (const bad of ["", "not json", "{}", JSON.stringify({ environment: [] }), JSON.stringify({ environment: ["x", 3] })]) assert.equal(parseDefaults(bad), null, bad);
});
