// Microsoft Graph, from C#: that the client is used, and -- only where the code
// says -- what for.
//
// The distinction the whole analyser exists for is between "Graph is here" and
// "Graph is used for drive items". The first needs the namespace or the client
// type in CODE; the second needs the request builder the code actually calls.
// A package reference alone produces neither: that is a declared technology,
// and the core already has it.
//
// Operations are named the way every SharePoint-reaching analyser names them
// (`files`, `lists`, `sites`), so a project that does files through one client
// and lists through another is two integration facts, one per client, and never
// one fact about "SharePoint".
import { code, defines, found, hasNamespace, matching, word } from "./csharp.mjs";

const OPERATIONS = [
  { re: /\bDriveItem\b|\.Drives?\b/, operation: "files", integration: (c) => (/\.Sites\b/.test(c) ? "sharepoint" : /\.Me\s*\.\s*Drive\b|\.Users\s*\[[^\]]*\]\s*\.Drive\b/.test(c) ? "onedrive" : undefined) },
  { re: /\.Lists\b|\bListItem\b/, operation: "lists", integration: () => "sharepoint" },
  { re: /\.Sites\b(?!\s*\[[^\]]*\]\s*\.(?:Drives?|Lists)\b)/, operation: "sites", integration: () => "sharepoint" },
  { re: /\.Users\b(?!\s*\[[^\]]*\]\s*\.Drive\b)/, operation: "users", integration: () => "identity" },
  { re: /\.Groups\b/, operation: "groups", integration: () => "identity" },
];

export const graph = {
  id: "dotnet.graph",
  ecosystem: "dotnet",
  doc: "Microsoft Graph client usage, and the request builders that say what it is used for",
  requires: ["microsoft-graph"],
  extensions: [".cs"],
  triggers: ["Microsoft.Graph", "GraphServiceClient"],
  operations: OPERATIONS.map((o) => o.operation),
  analyze: ({ text }) => graphUsage(code(text)),
};

function graphUsage(c) {
  const ns = hasNamespace(c, "Microsoft.Graph");
  const client = word(c, "GraphServiceClient");
  if (!ns && !client) return { usages: [], defines: defines(c) };
  const base = { technology: "microsoft-graph", confidence: ns && client ? "certain" : "possible", signals: [...(ns ? ["Microsoft.Graph"] : []), ...(client ? ["GraphServiceClient"] : [])] };
  return { defines: defines(c), usages: usagesOf(c, base) };
}

function usagesOf(c, base) {
  const ops = matching(c, OPERATIONS);
  if (!ops.length) return [base];
  return ops.map((o) => ({ ...base, operation: o.operation, ...(o.integration(c) ? { integration: o.integration(c) } : {}), signals: [...base.signals, ...found(c, o.re)], ...unknownsOf(o, c) }));
}

const unknownsOf = (o, c) => (o.integration(c) ? {} : { unknowns: ["whether these drive items live in SharePoint or OneDrive — nothing in this file names a site or a user"] });
