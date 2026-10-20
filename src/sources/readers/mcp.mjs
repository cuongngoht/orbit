// A reader that is a Orbit-MANAGED MCP server, asked through the broker and no other
// way.
//
// `invoke` is handed IN by the composition root: it is `invokeMcp` bound to the real
// invocation context (src/mcp/invoke.mjs), so every gate the broker holds -- the
// server is managed and not merely observed, it is enabled, the capability is one it
// provides, policy allows it, approval was given, its runtime is ready -- is passed
// exactly as for any other call, and this file has no second way to reach a server.
// A key that is not `managed:<id>` is refused here too: an external server is one
// Orbit observes and never calls, whatever its name.
//
// Which tool answers which acquisition, with which arguments, and where in the
// answer each field is, is DATA a descriptor supplies (see paths.mjs). This file
// knows the shape of that data and nothing about any server.
import { Blocked, Refused } from "../../errors.mjs";
import { ACQUISITION } from "../contract-v1.mjs";
import { WORKITEM_FIELDS } from "../fields.mjs";
import { answered } from "./answer.mjs";
import { fillArgs, mapped, specProblems } from "./paths.mjs";

// The four rows a mapping may hold, and the acquisition each answers.
export const MCP_ENTRIES = { read: "workitem.read", relations: "workitem.relations.read", comments: "workitem.comments.read", history: "workitem.history.read" };

const TOOL = /^[A-Za-z0-9_][A-Za-z0-9_.:/-]{0,127}$/;

const isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);

function argProblems(args, where) {
  if (args === undefined) return [];
  if (!isObject(args)) return [`${where}: args must be an object`];
  return Object.entries(args).filter(([, v]) => typeof v !== "string" && typeof v !== "number" && typeof v !== "boolean").map(([k]) => `${where}: args.${k} must be text, a number or true/false`);
}

function mapProblems(map, where) {
  if (!isObject(map) || !Object.keys(map).length) return [`${where}: map needs at least one field`];
  const unknown = Object.keys(map).filter((k) => !(k in WORKITEM_FIELDS)).map((k) => `${where}: map.${k} is not a work item field`);
  return [...unknown, ...Object.entries(map).flatMap(([k, spec]) => specProblems(spec, `${where}: map.${k}`))];
}

function entryProblems(entry, where) {
  if (!isObject(entry)) return [`${where} must be an object`];
  const tool = typeof entry.tool === "string" && TOOL.test(entry.tool) ? [] : [`${where}: tool must be a tool name (letters, digits and _ . : / -)`];
  return [...tool, ...argProblems(entry.args, where), ...mapProblems(entry.map, where)];
}

// What a descriptor's `mcp.tools` may say. `read` is the one that must be there: a
// server that cannot answer it is not a reader of work items.
export function mcpMappingProblems(tools, where = "mcp.tools") {
  if (!isObject(tools)) return [`${where} must be an object`];
  const unknown = Object.keys(tools).filter((k) => !(k in MCP_ENTRIES)).map((k) => `${where}.${k} is not a mapping this engine knows (${Object.keys(MCP_ENTRIES).join(", ")})`);
  const missing = tools.read === undefined ? [`${where}.read is required — a server that cannot read an item is not a reader`] : [];
  return [...unknown, ...missing, ...Object.entries(tools).filter(([k]) => k in MCP_ENTRIES).flatMap(([k, e]) => entryProblems(e, `${where}.${k}`))];
}

const providesOf = (tools) => ACQUISITION.map((a) => a.id).filter((id) => Object.entries(MCP_ENTRIES).some(([k, cap]) => cap === id && tools?.[k]));

const entryFor = (tools, capability) => tools[Object.keys(MCP_ENTRIES).find((k) => MCP_ENTRIES[k] === capability)];

// A tool's answer as structured data: its `structuredContent`, or its first text
// block read as JSON. A tool that reports an error, was cut short, or answered
// prose is the tool failing -- BLOCKED, and none of what it said is echoed.
function payloadOf(result, who) {
  if (result?.isError === true) throw new Blocked(`${who} reported an error for this item`);
  if (result?.truncated === true) throw new Blocked(`${who} answered more than may be read at once`);
  if (isObject(result?.structuredContent)) return result.structuredContent;
  return parsed((result?.content ?? []).find((c) => c?.type === "text")?.text, who);
}

function parsed(text, who) {
  try { return JSON.parse(text); }
  catch { throw new Blocked(`${who} answered text that is not JSON — a mapping reads structured data`); }
}

const serverOf = (key) => {
  const id = /^managed:(.+)$/.exec(String(key))?.[1];
  if (!id) throw new Refused(`an MCP reader is a Orbit-managed server (managed:<id>); ${key} is not one, and Orbit never calls a server it only observes`);
  return id;
};

async function read(invoke, tools, key, identity, capability) {
  const entry = entryFor(tools, capability);
  if (!entry) throw new Refused(`${key} has no mapping for ${capability}`);
  const values = { organization: identity.organization, project: identity.project, id: identity.id, ref: identity.id };
  const asked = await invoke({ id: serverOf(key), tool: entry.tool, args: fillArgs(entry.args, values), capability, workflow: "orbit-requirements" });
  return answered(mapped(payloadOf(asked.result, `${key} ${entry.tool}`), entry.map), capability, key, identity);
}

// `invoke(ask)` is invokeMcp bound to its context; `descriptorMcp` a descriptor's
// `mcp` block; `key` the resource key (`managed:<id>`). It is refused when the
// mapping does not hold, so a reader that would answer nonsense is never built.
export function mcpReader(invoke, descriptorMcp, key) {
  const problems = mcpMappingProblems(descriptorMcp?.tools);
  if (problems.length) throw new Refused(`this MCP mapping does not hold:\n  ${problems.join("\n  ")}`);
  serverOf(key);
  return { key, kind: "mcp", provides: providesOf(descriptorMcp.tools), resolves: () => null, read: (identity, capability) => read(invoke, descriptorMcp.tools, key, identity, capability) };
}
