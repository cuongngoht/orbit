import assert from "node:assert/strict";
import { test } from "node:test";
import { LineSplitter } from "./lines.js";

test("chunks become lines, whatever the chunk boundaries", () => {
  const lines: string[] = [];
  const s = new LineSplitter((l) => lines.push(l));
  s.push('{"a":');
  s.push('1}\n{"b"');
  s.push(":2}\r\n\n{");
  s.end();
  assert.deepEqual(lines, ['{"a":1}', '{"b":2}', "", "{"]);
});

test("a line longer than the limit is dropped whole and counted", () => {
  const lines: string[] = [];
  const s = new LineSplitter((l) => lines.push(l), 10);
  s.push("0123456789ABCDEF");
  s.push("GHI\nok\n");
  assert.deepEqual(lines, ["ok"]);
  assert.equal(s.dropped, 1);
});
