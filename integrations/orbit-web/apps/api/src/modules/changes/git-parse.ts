// Pure readers of git's machine formats: `status --porcelain=v2 -z --branch`, `diff --numstat -z` and
// `diff --name-status -z`. NUL-separated, so no path is ever misread whatever characters it holds.
import type { ChangeKind, ChangedFile } from "@orbit-web/contracts";

export interface StatusReport {
  oid: string | null;
  head: string | null;
  upstream: string | null;
  untracked: string[];
  conflicted: string[];
  changed: string[];
}

export function parseStatus(raw: string): StatusReport {
  const fields = raw.split("\0");
  const report: StatusReport = { oid: null, head: null, upstream: null, untracked: [], conflicted: [], changed: [] };
  for (let i = 0; i < fields.length; i += 1) {
    const f = fields[i] as string;
    if (f.startsWith("# branch.oid ")) report.oid = f.slice(13) === "(initial)" ? null : f.slice(13);
    else if (f.startsWith("# branch.head ")) report.head = f.slice(14) === "(detached)" ? null : f.slice(14);
    else if (f.startsWith("# branch.upstream ")) report.upstream = f.slice(18);
    else if (f.startsWith("? ")) report.untracked.push(f.slice(2));
    else if (f.startsWith("u ")) report.conflicted.push(f.split(" ").slice(10).join(" "));
    else if (f.startsWith("1 ")) report.changed.push(f.split(" ").slice(8).join(" "));
    else if (f.startsWith("2 ")) {
      report.changed.push(f.split(" ").slice(9).join(" "));
      i += 1;
    }
  }
  return report;
}

export interface Numstat {
  path: string;
  oldPath: string | null;
  additions: number | null;
  deletions: number | null;
  binary: boolean;
}

// `<add>\t<del>\t<path>\0`, or for a rename `<add>\t<del>\t\0<old>\0<new>\0`; a binary file counts `-`.
export function parseNumstat(raw: string): Numstat[] {
  const fields = raw.split("\0");
  const out: Numstat[] = [];
  for (let i = 0; i < fields.length; i += 1) {
    const f = fields[i] as string;
    const m = /^(-|\d+)\t(-|\d+)\t(.*)$/s.exec(f);
    if (!m) continue;
    const binary = m[1] === "-" && m[2] === "-";
    const counts = { additions: binary ? null : Number(m[1]), deletions: binary ? null : Number(m[2]), binary };
    if (m[3] !== "") {
      out.push({ path: m[3] as string, oldPath: null, ...counts });
      continue;
    }
    out.push({ path: fields[i + 2] ?? "", oldPath: fields[i + 1] ?? null, ...counts });
    i += 2;
  }
  return out.filter((n) => n.path.length > 0);
}

const KIND: Record<string, ChangeKind> = { A: "added", M: "modified", D: "deleted", R: "renamed", C: "copied", T: "type_changed", U: "conflicted" };

export interface NameStatus {
  path: string;
  oldPath: string | null;
  kind: ChangeKind;
}

// `<X>\0<path>\0`, or `R<score>\0<old>\0<new>\0` (and C for copies).
export function parseNameStatus(raw: string): NameStatus[] {
  const fields = raw.split("\0");
  const out: NameStatus[] = [];
  for (let i = 0; i < fields.length; i += 1) {
    const code = fields[i] as string;
    const letter = code.charAt(0);
    if (!/^[AMDRCTUXB]\d*$/.test(code)) continue;
    if (letter === "R" || letter === "C") {
      out.push({ oldPath: fields[i + 1] ?? null, path: fields[i + 2] ?? "", kind: KIND[letter] as ChangeKind });
      i += 2;
      continue;
    }
    out.push({ path: fields[i + 1] ?? "", oldPath: null, kind: KIND[letter] ?? "modified" });
    i += 1;
  }
  return out.filter((n) => n.path.length > 0);
}

// One list of changed files from what git said: committed and uncommitted changes against the base, files git does
// not track yet, and conflicts.
export function changedFiles(names: NameStatus[], counts: Numstat[], status: StatusReport, untrackedCounts: Map<string, Numstat>): ChangedFile[] {
  const countOf = new Map(counts.map((c) => [c.path, c]));
  const files = new Map<string, ChangedFile>();
  for (const n of names) {
    const c = countOf.get(n.path);
    files.set(n.path, { path: n.path, oldPath: n.oldPath, kind: n.kind, additions: c?.additions ?? null, deletions: c?.deletions ?? null, binary: c?.binary ?? false });
  }
  for (const path of status.untracked) {
    const c = untrackedCounts.get(path);
    files.set(path, { path, oldPath: null, kind: "untracked", additions: c?.additions ?? null, deletions: c?.deletions ?? null, binary: c?.binary ?? false });
  }
  for (const path of status.conflicted) files.set(path, { ...(files.get(path) ?? { path, oldPath: null, additions: null, deletions: null, binary: false }), kind: "conflicted" });
  return [...files.values()].sort((a, b) => a.path.localeCompare(b.path));
}

export function totalsOf(files: ChangedFile[]): { files: number; additions: number; deletions: number } {
  return files.reduce((t, f) => ({ files: t.files + 1, additions: t.additions + (f.additions ?? 0), deletions: t.deletions + (f.deletions ?? 0) }), { files: 0, additions: 0, deletions: 0 });
}

const LANGUAGES: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  mts: "typescript",
  cts: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  json: "json",
  md: "markdown",
  py: "python",
  rb: "ruby",
  go: "go",
  rs: "rust",
  java: "java",
  kt: "kotlin",
  cs: "csharp",
  c: "c",
  h: "c",
  cpp: "cpp",
  hpp: "cpp",
  sh: "bash",
  bash: "bash",
  yml: "yaml",
  yaml: "yaml",
  css: "css",
  scss: "scss",
  html: "xml",
  xml: "xml",
  sql: "sql",
  php: "php",
  swift: "swift",
  toml: "ini",
  ini: "ini",
  dockerfile: "dockerfile",
};

export function languageOf(path: string): string | null {
  const base = path.split("/").at(-1)?.toLowerCase() ?? "";
  if (base === "dockerfile") return "dockerfile";
  const ext = base.includes(".") ? (base.split(".").at(-1) ?? "") : "";
  return LANGUAGES[ext] ?? null;
}
