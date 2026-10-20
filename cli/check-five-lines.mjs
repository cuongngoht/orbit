#!/usr/bin/env node
// Structural check of Five Lines of Code over .mjs files.
//
//   node check-five-lines.mjs <file|dir>… [--limit=5] [--strict]
//
// Exit 1 on any error (else / switch / > 30 statements) or, with --strict, on
// any warning (> limit statements). The engine holds itself to --strict.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { lintText } from "../src/lint/five-lines.mjs";

const argv = process.argv.slice(2);
const STRICT = argv.includes("--strict");
const LIMIT = Number(argv.find((a) => a.startsWith("--limit="))?.slice(8) ?? 5);
const targets = argv.filter((a) => !a.startsWith("--"));

function files(p) {
  if (statSync(p).isFile()) return p.endsWith(".mjs") ? [p] : [];
  return readdirSync(p).filter((n) => n !== "node_modules").flatMap((n) => files(join(p, n)));
}

function main() {
  if (!targets.length) return usage();
  const findings = targets.flatMap(files).flatMap((f) => lintText(readFileSync(f, "utf8"), f, LIMIT));
  for (const x of findings) console.log(`${x.level.padEnd(5)} ${x.file}:${x.line}  ${x.name}()  rule ${x.rule}: ${x.message}`);
  summarise(findings);
}

function usage() {
  console.error("usage: node check-five-lines.mjs <file|dir>… [--limit=5] [--strict]");
  process.exit(2);
}

function summarise(findings) {
  const errors = findings.filter((x) => x.level === "error").length;
  console.log(`${findings.length} finding(s): ${errors} error(s), ${findings.length - errors} warning(s)`);
  process.exit(errors || (STRICT && findings.length) ? 1 : 0);
}

main();
