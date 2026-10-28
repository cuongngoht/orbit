// WHAT AN MCP TOOL CALL IS, as an action -- from what was DECLARED about the tool, never from its name or arguments.
//
// A catalog row may say which of its server's tools are a protected action (`protected`: tool name → kind, e.g. the
// tools that write a repository's refs are `repository.push`); otherwise the server's own annotation says whether the
// tool reads (MCP readOnlyHint) and, for a write, whether it is only additive (destructiveHint false). A write the server
// does not vouch for is `data.mutate`, the same unknown a capability that declares nothing is. Where a server lands is
// its own `environment` when one was declared, else unknown -- which is never production.
import { ACTION } from "./boundaries.mjs";

const annotated = (tool) => tool?.annotations ?? {};

const undeclaredKind = (tool) => (annotated(tool).readOnlyHint === true ? ACTION.DATA_READ : annotated(tool).destructiveHint === false ? ACTION.DATA_WRITE : ACTION.DATA_MUTATE);

const declaredKind = (server, tool) => (typeof server?.protected?.[tool?.name] === "string" ? server.protected[tool.name] : null);

// `server`: { key, environment?, protected? }; `tool`: the tool as the server listed it.
export const mcpAction = (server, tool, input = {}) => ({ kind: declaredKind(server, tool) ?? undeclaredKind(tool), environment: server?.environment ?? null, target: server?.key ?? null, server: server?.key ?? null, tool: tool?.name ?? null, input: input ?? {} });
