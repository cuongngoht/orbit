// SharePoint's client-side object model, from C#.
//
// Evidence is the CODE, never a file or class name: the client namespace, a
// ClientContext, and the object model's own members. `CsomListService.cs` with
// none of those in it reports nothing -- a name is somebody's intention, and
// this reads what the code does.
//
// Operations use the same words the Graph analyser uses, so the two can
// coexist on one integration without either being mistaken for the other:
// lists (List, ListItem, GetByTitle, CamlQuery), files (a file or folder by
// server-relative URL, the Files/Folders collections), and sites (webs, the
// site collection) -- never "sites" merely because every call starts at
// `ctx.Web`.
import { code, defines, found, hasNamespace, matching, word } from "./csharp.mjs";

const OPERATIONS = [
  { re: /\bListItem(?:Collection|CreationInformation)?\b|\.Lists\b|\bGetByTitle\b|\bCamlQuery\b|\bList\b(?!\s*<)/, operation: "lists" },
  { re: /\bGetFileByServerRelativeUrl\b|\bGetFolderByServerRelativeUrl\b|\bFileCreationInformation\b|\.Files\b|\.Folders\b|\bOpenBinaryDirect\b|\bSaveBinaryDirect\b/, operation: "files" },
  { re: /\.Webs\b|\bWebCreationInformation\b|\.Site\b/, operation: "sites" },
];

export const csom = {
  id: "dotnet.csom",
  ecosystem: "dotnet",
  doc: "SharePoint client object model usage: lists, files and sites, read off the members the code calls",
  requires: ["sharepoint-csom"],
  extensions: [".cs"],
  triggers: ["Microsoft.SharePoint.Client", "ClientContext"],
  operations: OPERATIONS.map((o) => o.operation),
  analyze: ({ text }) => csomUsage(code(text)),
};

function csomUsage(c) {
  const ns = hasNamespace(c, "Microsoft.SharePoint.Client");
  const context = word(c, "ClientContext");
  if (!ns && !context) return { usages: [], defines: defines(c) };
  const base = { technology: "sharepoint-csom", integration: "sharepoint", confidence: ns && context ? "certain" : "possible", signals: [...(ns ? ["Microsoft.SharePoint.Client"] : []), ...(context ? ["ClientContext"] : [])] };
  return { defines: defines(c), usages: usagesOf(c, base) };
}

function usagesOf(c, base) {
  const ops = matching(c, OPERATIONS);
  return ops.length ? ops.map((o) => ({ ...base, operation: o.operation, signals: [...base.signals, ...found(c, o.re)] })) : [base];
}
