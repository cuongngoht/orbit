// A HIDDEN ACCEPTANCE TEST of a task pack (this file is copied into every pack as hidden/acceptance.spec.mjs, and into
// the grading container as a test file of the candidate). It asks the pack's spec for its checks -- inputs and what
// each must come to, from the request's own words and never from the candidate's code -- hands the inputs alone to the
// pack's probe, which imports the candidate's modules in a process of its own, and holds every answer to its check:
// one node test per group of checks. EVAL_HIDDEN names the directory the pack's hidden files were copied to.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";

const HIDDEN = process.env.EVAL_HIDDEN;
const meta = JSON.parse(readFileSync(join(HIDDEN, "acceptance", "meta.json"), "utf8"));
const spec = await import(pathToFileURL(join(HIDDEN, "acceptance", "spec.mjs")).href);
const cases = spec.cases(meta.seed, meta.samples);

const uniq = (ids) => [...new Set(ids)].sort();
const listed = (ids) => (ids.length ? ids.join(", ") : "nothing");
const sameSet = (a, b) => JSON.stringify(uniq(a)) === JSON.stringify(uniq(b));

// An answer held to its check: `exactly` (the whole set), `has` (each there), `lacks` (none there).
function judged(c, a) {
  if (!a) return "no answer came back for it";
  if (a.threw !== undefined) return `it threw: ${String(a.threw).slice(0, 200)}`;
  if (!Array.isArray(a.got) || !a.got.every((x) => typeof x === "string")) return "its answer is not a list of ids";
  const e = c.expect ?? {};
  const got = uniq(a.got);
  if (Array.isArray(e.exactly) && !sameSet(e.exactly, got)) return `expected exactly ${listed(uniq(e.exactly))}, and ${listed(got)} came back`;
  if ((e.has ?? []).some((id) => !got.includes(id))) return `expected ${listed(e.has)} among them, and ${listed(got)} came back`;
  if ((e.lacks ?? []).some((id) => got.includes(id))) return `expected none of ${listed(e.lacks)}, and ${listed(got)} came back`;
  return null;
}

const parsed = (line) => {
  try { return ((j) => (j && (Array.isArray(j.answers) || j.error) ? j : null))(JSON.parse(line)); }
  catch { return null; }
};

const probe = spawnSync(process.execPath, [join(HIDDEN, "acceptance", "probe.mjs"), process.cwd()], { input: JSON.stringify({ inputs: cases.map((c) => ({ id: c.id, ...c.input })) }), encoding: "utf8", timeout: meta.probeSeconds * 1000, killSignal: "SIGKILL", maxBuffer: 64 * 1024 * 1024 });
const read = String(probe.stdout ?? "").split("\n").map(parsed).filter(Boolean).at(-1) ?? { error: { code: probe.error?.code ?? "PROBE_UNREADABLE" } };
const answers = new Map((read.answers ?? []).filter((a) => a && typeof a.id === "string").map((a) => [a.id, a]));
const groups = [...new Set(cases.map((c) => c.group))];

for (const group of groups) {
  test(`${group}: ${spec.GROUPS?.[group] ?? group}`, () => {
    assert.equal(read.error, undefined, `the probe could not answer: ${JSON.stringify(read.error)}`);
    const wrong = cases.filter((c) => c.group === group).map((c) => ({ id: c.id, why: (spec.judged ? spec.judged(c, answers.get(c.id)).why : judged(c, answers.get(c.id))) })).filter((w) => w.why);
    assert.deepEqual(wrong, []);
  });
}
