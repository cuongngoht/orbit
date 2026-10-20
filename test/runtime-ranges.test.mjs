// A manifest's version range, read the way npm reads it -- and never turned into a verdict about a
// machine when it cannot be read. `^20 || >=22`, `22`, `20.x` and `~1.2` are the usual ways a package
// says which runtime it needs; reading them as "exactly 22.0.0" blocked machines that run the thing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { alternatives, judged, lowerBound, readable } from "../src/runtime/ranges.mjs";

const says = (version, range) => judged(version, range).state;

test("a bare or partial version is a line, not an exact version padded with zeros", () => {
  assert.equal(says("22.23.1", "22"), "compatible");
  assert.equal(says("22.23.1", "22.23"), "compatible");
  assert.equal(says("23.0.0", "22"), "incompatible");
  assert.equal(says("8.0.100", "8.0"), "compatible");
  assert.equal(says("8.1.0", "8.0"), "incompatible");
  assert.equal(says("22.1.0", "22.1.0"), "compatible", "three parts name that version");
  assert.equal(says("22.1.1", "22.1.0"), "incompatible");
  assert.equal(says("20.5.0", "20.x"), "compatible");
  assert.equal(says("21.0.0", "20.x"), "incompatible");
  assert.equal(says("1.2.9", "1.2.*"), "compatible");
});

test("caret and tilde mean what npm says they mean", () => {
  const cases = [["^1.2.3", "1.2.2", false], ["^1.2.3", "1.9.0", true], ["^1.2.3", "2.0.0", false], ["^0.2.3", "0.2.9", true], ["^0.2.3", "0.3.0", false], ["^0.0.3", "0.0.3", true], ["^0.0.3", "0.0.4", false], ["^20", "20.9.0", true], ["^20", "22.1.0", false], ["~1.2.3", "1.2.9", true], ["~1.2.3", "1.3.0", false], ["~1.2", "1.2.5", true], ["~1.2", "1.3.0", false], ["~1", "1.9.0", true], ["~1", "2.0.0", false]];
  for (const [range, version, ok] of cases) assert.equal(says(version, range), ok ? "compatible" : "incompatible", `${version} against ${range}`);
});

test("alternatives are tried in turn: one that holds is enough, and none that hold is a no", () => {
  assert.equal(says("22.0.0", "^18.17 || >=20"), "compatible");
  assert.equal(says("18.17.0", "^18.17 || >=20"), "compatible");
  assert.equal(says("18.16.0", "^18.17 || >=20"), "incompatible");
  assert.equal(says("19.0.0", "^18.17 || >=20"), "incompatible");
  assert.equal(says("22.1.0", "*"), "compatible");
  assert.equal(says("22.1.0", ">= 18.0.0"), "compatible", "a space after the operator is allowed");
  assert.equal(says("22.1.0", ">=18 <20"), "incompatible");
});

test("what cannot be read is UNKNOWN -- never incompatible, however the machine's version looks", () => {
  for (const range of ["latest", "lts/*", "^foo", "1.2 - 1.5", ">22", "<=22", ">=1.x", "workspace:*", "a || b"]) {
    assert.equal(says("22.1.0", range), "unknown", range);
    assert.equal(readable(range), false, range);
  }
  assert.equal(says(null, "22"), "unknown", "a machine version nobody read is not a mismatch");
});

test("a miss says it about the tool, in this subject's words -- not the extension loader's", () => {
  const miss = judged("3.9.6", ">=3.13 <4");
  assert.equal(miss.state, "incompatible");
  assert.equal(miss.why, "3.9.6 does not satisfy >=3.13 <4");
  assert.doesNotMatch(judged("1.0.0", "^2").why, /engine|extension/);
  assert.match(judged("22.1.0", "lts/*").why, /a range this does not read/);
  assert.equal(judged("22.1.0", "").state, "compatible", "no range asks for nothing");
});

test("the version to install is the newest floor of what is asked, written the way the file wrote it", () => {
  const floors = { ">=8.0": "8.0", "^20": "20", "^18.17 || >=20": "20", "~1.2.3": "1.2.3", "20.x": "20", ">=18 <20": "18", "22": "22", "=22.1.0": "22.1.0", ">=22.5": "22.5" };
  for (const [range, floor] of Object.entries(floors)) assert.equal(lowerBound(range), floor, range);
  for (const range of ["*", "<5", "latest", "", undefined]) assert.equal(lowerBound(range), null, String(range));
});

test("a range is its alternatives, each a list of comparators the shared subset reads", () => {
  assert.deepEqual(alternatives("^18.17 || >=20"), [[">=18.17", "<19"], [">=20"]]);
  assert.deepEqual(alternatives("*"), [[]]);
  assert.deepEqual(alternatives("~1"), [[">=1", "<2"]]);
  assert.equal(alternatives("1.x.x || nonsense"), null);
});

test("a machine's preview build is judged by its number, the way a person reads it: 9.0.100-preview.5 satisfies >=8.0", () => {
  assert.equal(says("9.0.100-preview.5", ">=8.0"), "compatible");
  assert.equal(says("8.0.0-rc.1", ">=8.0"), "incompatible", "but a preview of a release is not yet that release");
});
