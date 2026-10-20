// The port Control listens on: `--port=<n>` and `--port <n>` say the same thing -- the second is how a
// sandbox's argument override tells a component its port -- and anything else is bad usage, never a guess.
import { test } from "node:test";
import assert from "node:assert/strict";
import { USAGE, portOf } from "../src/port.mjs";

const usage = (e) => e instanceof Error && e.message.endsWith(USAGE);

test("no argument is port 0: the OS picks a free one", () => {
  assert.equal(portOf([]), 0);
});

test("--port=<n> and --port <n> name the same port", () => {
  assert.equal(portOf(["--port=7317"]), 7317);
  assert.equal(portOf(["--port", "7317"]), 7317);
  assert.equal(portOf(["--port", "0"]), 0);
  assert.equal(portOf(["--port=65535"]), 65535);
});

// `npm run start -- --port 61234` -- what an override { kind: "argv", flag: "--port", after: "--" } launches --
// hands main.mjs the two words after the `--`.
test("a sandbox's argument override is read as it is launched: the flag and the port as two words", () => {
  assert.equal(portOf(["--port", "61234"]), 61234);
});

test("a port that is not a whole number from 0 to 65535 is refused, with the usage", () => {
  for (const bad of [["--port=65536"], ["--port", "-1"], ["--port", "1.5"], ["--port="], ["--port", ""], ["--port=0x10"], ["--port", "80 "], ["--port", "--port=80"]]) assert.throws(() => portOf(bad), usage, JSON.stringify(bad));
});

test("anything else is bad usage: a missing value, another flag, a repeated port, a stray word", () => {
  for (const bad of [["--port"], ["--host=0.0.0.0"], ["--port=1", "--port=2"], ["--port", "1", "2"], ["7317"], ["--port=1", "x"], ["-p", "7317"]]) assert.throws(() => portOf(bad), (e) => e instanceof Error && e.message === USAGE, JSON.stringify(bad));
});

test("the usage names both spellings", () => {
  assert.match(USAGE, /--port=<n> \| --port <n>/);
});
