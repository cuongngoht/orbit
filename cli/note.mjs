#!/usr/bin/env node
// Remember one thing about this project, for the whole team.
//
//   node note.mjs <about> "<title>" "<body>" [--type=trap|decision|finding]
//
// <about> is a key the map already uses -- case:<id>, screen:<id>,
// "<screen>/<via>", machine, project -- so `query.mjs notes <about>` recalls it
// for exactly the thing in hand instead of loading the store. The note lands in
// ui-tests/memory/notes/ and is COMMITTED: what one tester worked out is what
// the next one needs. It is stamped with the machine that wrote it and the
// frontend commit it was true at, and `notes` says STALE once the frontend
// moves past it.
//
// Exit 0 = written, 2 = usage.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { makeNote } from "../src/memory/note.mjs";
import { createContext } from "../src/run/context.mjs";

const argv = process.argv.slice(2);
const flag = (name) => argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const [about, title, body] = argv.filter((a) => !a.startsWith("--"));

function main() {
  if (!about || !title || !body) return usage();
  const ctx = createContext();
  const note = makeNote({ about, title, body, type: flag("type"), fe_commit: ctx.frontend.commit() });
  console.log(`remembered: ${ctx.memory.saveNote(note)}`);
}

function usage() {
  console.error(readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(1, 12).join("\n"));
  process.exit(2);
}

main();
