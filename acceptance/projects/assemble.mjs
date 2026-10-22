#!/usr/bin/env node
// Assembles ONE stack into a self-contained project directory -- what an acceptance run makes a
// checkout of. It holds the stack's own files, the shared application, the shared contracts and the
// shared ACCEPTED plan byte for byte (so both stacks are held to identical contracts), and the import closure of any
// client the stack vendors -- nothing else of this repository, and nothing under src/.
//
//   node acceptance/projects/assemble.mjs <invoice-a | invoice-b> <dest> [--variant=<name>] [--force]
//
// --variant writes app/VARIANT: the image then runs that variant (see app/config.mjs). It is a
// different TREE, as a defect in real code would be, and it is never said by the running app.
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..");

export const VARIANTS = ["correct", "no-tenant-check", "broken-auth", "no-dedupe", "early-ack", "no-db-write", "toast-without-persistence"];

// What each stack vendors: a client's entry module, copied with every module it imports.
export const STACKS = {
  "invoice-a": { vendor: { amqp: join(REPO, "skills", "orbit-backend-test", "amqp", "index.mjs") } },
  "invoice-b": { vendor: {} },
};

function closureOf(entry) {
  const seen = new Set();
  const visit = (file) => {
    if (seen.has(file)) return;
    seen.add(file);
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(/(?:from|import)\s*["'](\.{1,2}\/[^"']+)["']/g)) {
      const next = resolve(dirname(file), m[1]);
      if (dirname(next) !== dirname(entry)) throw new Error(`${file} imports ${m[1]}, outside the client's own directory`);
      visit(next);
    }
  };
  visit(entry);
  return [...seen];
}

export function assemble(stack, dest, { variant = "correct", force = false } = {}) {
  if (!STACKS[stack]) throw new Error(`no stack ${stack} (one of ${Object.keys(STACKS).join(", ")})`);
  if (!VARIANTS.includes(variant)) throw new Error(`no variant ${variant} (one of ${VARIANTS.join(", ")})`);
  if (existsSync(dest) && readdirSync(dest).length) {
    if (!force) throw new Error(`${dest} is not empty (use --force to replace it)`);
    rmSync(dest, { recursive: true, force: true });
  }
  mkdirSync(dest, { recursive: true });
  cpSync(join(HERE, stack), dest, { recursive: true });
  cpSync(join(HERE, "_shared", "app"), join(dest, "app"), { recursive: true });
  cpSync(join(HERE, "_shared", "contracts"), join(dest, "contracts"), { recursive: true });
  cpSync(join(HERE, "_shared", "ui-tests"), join(dest, "ui-tests"), { recursive: true });
  for (const [name, entry] of Object.entries(STACKS[stack].vendor)) {
    mkdirSync(join(dest, "vendor", name), { recursive: true });
    for (const file of closureOf(entry)) copyFileSync(file, join(dest, "vendor", name, file.slice(dirname(entry).length + 1)));
  }
  if (variant !== "correct") writeFileSync(join(dest, "app", "VARIANT"), `${variant}\n`);
  return dest;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const flags = Object.fromEntries(args.filter((a) => a.startsWith("--")).map((a) => a.slice(2).split("=")).map(([k, v]) => [k, v ?? true]));
  const [stack, dest] = args.filter((a) => !a.startsWith("--"));
  if (!stack || !dest) {
    console.error("usage: node acceptance/projects/assemble.mjs <invoice-a | invoice-b> <dest> [--variant=<name>] [--force]");
    process.exit(2);
  }
  try {
    console.log(assemble(stack, resolve(dest), { variant: flags.variant ?? "correct", force: Boolean(flags.force) }));
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
