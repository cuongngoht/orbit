// Bash-safe text: single-quoted values and wrapped comments.
export const sh = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

export const comment = (text, indent = "") =>
  String(text).replace(/(.{1,74})(\s|$)/g, "$1\n").trim().split("\n").map((l) => `${indent}# ${l}`).join("\n");

export const varName = (s) => s.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 28);
