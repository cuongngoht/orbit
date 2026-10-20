// Turn a click-path through the map into a readable playwright-cli script.
// The walker knows which controls sit between two screens; it cannot know
// what to type, in what order, or what to wait for -- that is a test CASE.
import { edgeKey, route } from "../graph/index.mjs";
import { comment, sh, varName } from "./shell.mjs";
import { verifyBlock } from "./verify-block.mjs";

const INPUT_KINDS = new Set(["textbox", "searchbox", "combobox"]);
const inputsOn = (graph, screenId) => graph.edges.filter((e) => e.from === screenId && INPUT_KINDS.has(e.kind));

export function emit(ctx, from, to) {
  const steps = route(ctx.graph, from, to);
  if (!steps) return [`# no path ${from} -> ${to}`];
  const start = ctx.graph.screens.get(from);
  const params = [...(start?.url ?? "").matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
  return [...head(ctx, start, from, to), ...variables(ctx, steps), ...routeParams(params, start), ...preconditions(ctx, start, params), ...body(ctx, steps)];
}

function head(ctx, start, from, to) {
  return ["#!/usr/bin/env bash", "# GENERATED from the UI map by plan.mjs — regenerate, do not hand-edit.", `# Flow: ${start?.name ?? from}  ->  ${ctx.graph.screens.get(to)?.name ?? to}`, "#",
    comment("Read this before running it. It clicks a real UI in a real environment. Selectors come from the map and may be stale — run `query verify` first."), "set -euo pipefail", ""];
}

// A text input on the way to a commit has to be filled or the commit is
// disabled; the script cannot know what to type, so it emits a variable.
function variables(ctx, steps) {
  const vars = steps.flatMap(({ at }) => inputsOn(ctx.graph, at));
  if (!vars.length) return [];
  const lines = vars.flatMap((v) => [...(v.note ? [comment(v.note)] : []), `${varName(v.via)}=${sh(v.required ? `TC-${varName(v.via).toLowerCase()}` : "")}   ${v.required ? "# REQUIRED" : "# optional"}`]);
  return ["# --- values you must supply ------------------------------------------------", comment("Name test objects with a TC- prefix so cleanup and later runs can tell them apart from real customer data."), ...lines, ""];
}

// A url like /things/{thingId}/detail is a template; emitted verbatim it
// navigates to a literal brace and fails three steps later.
function routeParams(params, start) {
  if (!params.length) return [];
  return ["# --- route parameters -----------------------------------------------------", ...params.map((p) => `${varName(p)}=''   # REQUIRED — ${p} in ${start.url}`), ""];
}

function preconditions(ctx, start, params) {
  const L = ["# --- preconditions --------------------------------------------------------", comment(`Sign in first; this script never handles credentials:\n  playwright-cli open --persistent --browser=${ctx.config.launch.channel} ${ctx.config.origin}${start?.url ?? ""}`)];
  if (start?.admin) L.push(comment("This screen is admin-only — the signed-in account needs an administrator role."));
  if (start?.note) L.push(comment(`TRAP on the starting screen: ${start.note}`));
  return [...L, "", ...gotoLines(ctx, start, params)];
}

function gotoLines(ctx, start, params) {
  if (!start?.url) return [];
  const url = params.reduce((u, p) => u.replace(`{${p}}`, "${" + varName(p) + "}"), ctx.config.origin + start.url);
  return [params.length ? `playwright-cli goto "${url}"` : `playwright-cli goto ${sh(url)}`,
    comment("Verify the landing screen. A route absent from this environment's menu renders a fallback screen instead of 404ing, and every later click would then be wrong."), `playwright-cli --raw eval ${sh("location.pathname")}`, ""];
}

function body(ctx, steps) {
  return ["# --- steps ----------------------------------------------------------------", ...steps.flatMap(({ at, e }, i) => stepLines(ctx, at, e, i + 1))];
}

function stepLines(ctx, at, e, n) {
  const L = [`# ${n}. on ${ctx.graph.screens.get(at)?.name ?? at}: ${e.via}`];
  if (e.note) L.push(comment(e.note));
  const fx = ctx.graph.effectOn.get(edgeKey(e));
  return [...L, ...fillLines(ctx, at), ...clickLines(e), ...(fx ? verifyBlock(fx, ctx.graph.meta) : []), ""];
}

function fillLines(ctx, at) {
  return inputsOn(ctx.graph, at).flatMap((inp) => [`[ -n "\${${varName(inp.via)}}" ] && playwright-cli fill ${sh(inp.selector)} "\${${varName(inp.via)}}"`,
    ...(inp.kind === "combobox" ? [comment("A combobox needs its option clicked after the debounce; the map note above says how long. Add the click once you have run this manually.")] : [])]);
}

function clickLines(e) {
  if (e.destructive) return [comment("DESTRUCTIVE — left commented out deliberately. Confirm the target is a disposable TC- object, then uncomment. See the effect record for what it deletes."), `# playwright-cli click ${sh(e.selector)}`];
  if (e.selector === "UNKNOWN" || !e.selector) return [comment("Selector not captured in the map. Snapshot with a target, find the real one, run it, and record the correction in edges.json in the same session."), `# playwright-cli click '<fill me in>'`];
  return [`playwright-cli click ${sh(e.selector)}`];
}
