#!/usr/bin/env node
// THE SCRIPTED HOST: what a repair control runs in the runner container in place of a coding host. It drives the
// round's ONE engineering task through Orbit's own loop -- cli/autonomous-engineering.mjs, one decided step at a time,
// exactly as a host drives it -- and makes the edits its control defines in that task's own workspace. No model, no
// network, no credential: a control proves the controller, the engine and the verifier, never a model, and every
// report says so (host basis SCRIPTED). It decides nothing: the inspection reads back what it left, and a verifier that
// shares nothing with it judges. It does not diagnose either: at the first check that fails it stops and says where
// the task stands.
//
// What it prints is stream-json, the shape the controller reads a host's session in: an init line naming its model
// `scripted:<control>`, one tool call per step it took, and a result line -- its cost is 0, because no model ran.
//
//   node /bench/scripted.mjs <tsk-…>     brief: /run/brief/brief.json (its `script` and `plugin`)   prints: stream-json
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

export const PATHS = { brief: "/run/brief/brief.json", repo: "/work/repo" };

const said = (event) => process.stdout.write(`${JSON.stringify(event)}\n`);

const jsonOf = (text) => {
  try { return JSON.parse(text); }
  catch { return null; }
};

const lastLine = (r) => String(r.stderr || r.stdout || r.error?.message || "").trim().split("\n").at(-1)?.slice(0, 300) ?? "";

// One command of Orbit's engineering loop, run as a host runs it: from the checkout, the plugin's own CLI. (`s.env` and
// `s.say` exist so a test can run this outside the container; in it, the process's own are used.)
export const orbitCall = (s, args, input) => ((r) => ({ status: r.status, json: jsonOf(r.stdout), why: lastLine(r) }))(spawnSync(process.execPath, [join(s.plugin, "cli", "autonomous-engineering.mjs"), ...args, "--json"], { cwd: s.repo, env: s.env ?? process.env, input, encoding: "utf8", timeout: 3600000, maxBuffer: 64 * 1024 * 1024 }));

// Where the task stands, and the revision the next decision is made on.
export function contextOf(s) {
  const r = orbitCall(s, ["context", s.task]);
  s.revision = r.json?.revision ?? s.revision;
  return r.json;
}

const decisionOf = (s, action) => JSON.stringify({ schemaVersion: 1, expectedRevision: s.revision, action, observed: "the context allows this step", hypothesis: "it moves the change toward verified" });

// ONE decided step, as a tool call of the session: judged, recorded, run and settled by the engine.
export function stepped(s, action) {
  const r = orbitCall(s, ["step", s.task], decisionOf(s, action));
  (s.say ?? said)({ type: "assistant", message: { content: [{ type: "tool_use", name: "Bash", input: { orbit: `autonomous-engineering step ${action.kind}` } }] } });
  s.revision = r.json?.revision ?? s.revision;
  s.steps.push({ kind: action.kind, status: r.status, outcome: r.json?.outcome ?? null, stage: r.json?.stage ?? null, lifecycle: r.json?.lifecycle ?? null, why: r.status ? r.why : null });
  return r;
}

// ---- the edits a definition names, made in the task's own workspace ----------------------------------------------------

const occurrences = (text, find) => text.split(find).length - 1;

function mutated(dir, m) {
  const file = join(dir, m.file);
  const text = existsSync(file) ? readFileSync(file, "utf8") : "";
  if (occurrences(text, m.find) !== m.count) return `${m.id}: expected ${m.count} occurrence(s) in ${m.file}, found ${occurrences(text, m.find)}`;
  writeFileSync(file, text.split(m.find).join(m.replace));
  return null;
}

const written = (dir, f) => (mkdirSync(dirname(join(dir, f.rel)), { recursive: true }), writeFileSync(join(dir, f.rel), f.lines.map((l) => `${l}\n`).join("")), null);

const deleted = (dir, rel) => (rmSync(join(dir, rel), { force: true }), null);

// Every edit of the definition, in order: what it could not do, or nothing.
export const edited = (dir, d) => [...(d.mutations ?? []).map((m) => mutated(dir, m)), ...(d.files ?? []).map((f) => written(dir, f)), ...(d.deletes ?? []).map((rel) => deleted(dir, rel))].filter(Boolean);

export const scopeOf = (d) => [...new Set([...(d.mutations ?? []).map((m) => m.file), ...(d.files ?? []).map((f) => f.rel), ...(d.deletes ?? [])])];

// ---- the loop, from a fresh task to a reviewed change ----------------------------------------------------------------

const PREPARING = [{ kind: "gather-context" }, { kind: "check-environment" }, { kind: "prepare-workspace" }];

function prepared(s) {
  contextOf(s);
  for (const a of PREPARING) stepped(s, a);
  return contextOf(s);
}

function implemented(s, c) {
  stepped(s, { kind: "plan", intent: s.script.intent, scope: scopeOf(s.script.definition) });
  stepped(s, { kind: "implement" });
  const problems = c?.workspace?.path ? edited(c.workspace.path, s.script.definition) : ["the engineering task has no workspace"];
  stepped(s, { kind: "record-changes" });
  return problems;
}

// Each check the change is required to pass, in turn -- and none after the first that does not succeed.
function checked(s) {
  const required = (contextOf(s)?.verificationPlan?.required ?? []).filter((x) => x.settled !== true);
  for (const x of required) if (stepped(s, { kind: "check", command: x.id }).json?.outcome !== "succeeded") return [`the required check ${x.id} did not succeed: the task stays where it stands`];
  return [];
}

// A change that passed its checks: committed in the task's own delivery, then reviewed -- what completes the task.
function delivered(s) {
  if ((contextOf(s)?.allowed ?? []).includes("commit")) stepped(s, { kind: "commit", message: String(s.script.intent).slice(0, 200) });
  const r = stepped(s, { kind: "review" });
  return r.status === 0 ? [] : [`review: ${r.why}`];
}

function applied(s) {
  const problems = implemented(s, prepared(s));
  if (problems.length) return problems;
  const failed = checked(s);
  return failed.length ? failed : delivered(s);
}

// What a script does: APPLY its definition through the whole loop, or sit IDLE -- change nothing at all.
export const SCRIPTS = { apply: applied, idle: () => [] };

function main(task) {
  const b = JSON.parse(readFileSync(PATHS.brief, "utf8"));
  const s = { task, repo: PATHS.repo, plugin: b.plugin ?? PATHS.repo, script: b.script ?? {}, revision: null, steps: [] };
  said({ type: "system", subtype: "init", model: `scripted:${s.script.id ?? "unnamed"}`, session_id: `scripted-${task}`, claude_code_version: null });
  const problems = contextOf(s) ? (SCRIPTS[s.script.mode] ?? SCRIPTS.apply)(s) : ["the engineering task could not be read"];
  said({ type: "result", subtype: problems.length ? "error_during_execution" : "success", is_error: problems.length > 0, num_turns: s.steps.length, total_cost_usd: 0, result: problems.join("; ").slice(0, 300) || "the script ran to its end", steps: s.steps });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main(process.argv[2]);
