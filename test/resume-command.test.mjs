// Every RESUME target says HOW, not only WHAT (0.6.0, Q7): a host that comes back to open work -- through the router's
// RESUME line, a hook's owner line, a goal's resume or an engineering task's context -- is told the one Orbit command
// that goes on, and that command is one the CLI it names really takes (its file is there, and its own usage header
// names the subcommand). Held across every row of every table a resume target is read from, never one case.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { RESUMES } from "../src/routing/strategy.mjs";
import { OWNERS } from "../src/lifecycle/owners.mjs";
import { RESUME_NEXT, resumeNext } from "../src/goal/resume.mjs";
import { apply } from "../src/task/ops.mjs";
import { contextOf, step } from "../src/orchestration/loop.mjs";
import { orchestrationWorld, prepared } from "./fakes/orchestration.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// `node <engine>/cli/x.mjs a b <id> --flag`: the file, and the bare words that name its subcommand.
const COMMAND = /node <engine>\/((?:satellite\/)?cli\/[a-z][a-z-]*\.mjs)((?: [a-z][a-z-]*(?=\s|$))*)/g;

const commandsIn = (text) => [...String(text).matchAll(COMMAND)].map((m) => ({ file: m[1], words: m[2].trim().split(" ").filter(Boolean) }));

const usageOf = (file) => readFileSync(join(ROOT, file), "utf8").split("\n").filter((l) => l.startsWith("//"));

// A usage line of the CLI's own header that names every word of the subcommand (`goal plan|status|resume` counts).
const takes = (c) => usageOf(c.file).some((l) => l.includes(`node ${c.file.split("/").pop()}`) && c.words.every((w) => l.split(/[\s|]+/).includes(w)));

function executable(text, where) {
  const found = commandsIn(text);
  assert.ok(found.length > 0, `${where} names no Orbit command: ${text}`);
  for (const c of found) assert.ok(existsSync(join(ROOT, c.file)) && takes(c), `${where}: ${c.file} ${c.words.join(" ")} is not a command that CLI takes`);
}

test("the router's RESUME rows each name a command the owner's CLI takes", () => {
  for (const [kind, row] of Object.entries(RESUMES)) executable(row("tsk-0123456789ab"), `RESUMES.${kind}`);
});

test("every owner a hook names is read, reconciled and settled through a command its CLI takes", () => {
  for (const [kind, owner] of Object.entries(OWNERS)) for (const how of ["read", "reconcile", "settle", "report"].filter((k) => owner[k])) executable(owner[how]("tsk-0123456789ab", "arn-0123456789ab"), `OWNERS.${kind}.${how}`);
});

// One goal view per row of RESUME_NEXT, each made so that row is the first that holds.
const unit = (state, extra = {}) => ({ id: "gu-1", title: "the refund rule", state, ...extra });
const goalView = (over) => ({ model: { meta: { id: "goal-0123456789ab", title: "refunds" }, analyzed: {}, plan: {}, units: new Map(), verified: null, ...over.model }, frontier: over.frontier ?? [] });
const VIEWS = {
  ANALYZE: goalView({ model: { analyzed: null } }),
  PLAN: goalView({ model: { plan: null } }),
  STEP: goalView({ frontier: [unit("planned")] }),
  RUNNING: goalView({ model: { units: new Map([["gu-1", unit("running", { task: "tsk-0123456789ab" })]]) } }),
  REPORT: goalView({ model: { verified: { outcome: "completed" } } }),
  VERIFY: goalView({}),
};

test("a resumed goal's NEXT names the command that goes on, in every state its table knows", () => {
  assert.deepEqual(Object.keys(VIEWS), RESUME_NEXT.map((r) => r.id), "one view per row");
  for (const row of RESUME_NEXT) {
    assert.equal(RESUME_NEXT.find((r) => r.when(VIEWS[row.id])).id, row.id, `${row.id} is the row that holds for its view`);
    executable(resumeNext(VIEWS[row.id]), `goal RESUME_NEXT.${row.id}`);
  }
});

test("an engineering task's context and step answer say the decision to send, and it is one step takes as it is", async (t) => {
  const o = orchestrationWorld(t);
  const { id } = await prepared(o);
  const c = contextOf(o.ports, id);
  executable(c.do, "an engineering task's DO");
  const sent = JSON.parse(/ with (\{.*\}) on stdin$/.exec(c.do)[1].replace("…its fields", "\"intent\": \"reject a refund over what was paid\", \"scope\": [\"src/RefundValidator.cs\"]").replace(/"kind": "<[^"]*>"/, '"kind": "plan"'));
  const r = await step(o.ports, id, sent);
  assert.equal(r.outcome, "succeeded", "the decision shown, with its kind and fields filled in, is taken as it is");
  executable(r.do, "a step answer's DO");
});

test("a task only a person moves names no command to step it", async (t) => {
  const o = orchestrationWorld(t);
  const { id } = await prepared(o);
  apply(o.w.ctx, id, "pause", { human: true, expected: o.w.view(id).revision, because: "lunch" });
  assert.equal(contextOf(o.ports, id).do, null, "paused: a person resumes it, in Orbit Control");
});
