#!/usr/bin/env node
// Run once, while the QA worker image is built: the Chromium revisions the browser CLI's own Playwright names
// (its browsers.json), each pointed at the revision of the same browser the base image ships, when the two differ.
// Every link is printed, so the build log says which browser a test will really drive.
//
//   node link-browsers.mjs <browsers.json>          in $PLAYWRIGHT_BROWSERS_PATH
import { existsSync, readdirSync, readFileSync, symlinkSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.env.PLAYWRIGHT_BROWSERS_PATH || "/ms-playwright";

const dirOf = (name) => name.replace(/-/g, "_");

const shipped = (name) => readdirSync(ROOT).find((d) => d.startsWith(`${dirOf(name)}-`) && /^\d+$/.test(d.slice(dirOf(name).length + 1))) ?? null;

function linked(b) {
  const want = `${dirOf(b.name)}-${b.revision}`;
  const have = shipped(b.name);
  if (!existsSync(join(ROOT, want)) && have) symlinkSync(have, join(ROOT, want));
  return `${want} -> ${existsSync(join(ROOT, want)) ? (have ?? want) : "MISSING"}`;
}

const browsers = JSON.parse(readFileSync(process.argv[2], "utf8")).browsers.filter((b) => /^chromium/.test(b.name));
for (const line of browsers.map(linked)) process.stdout.write(`${line}\n`);
if (browsers.some((b) => !existsSync(join(ROOT, `${dirOf(b.name)}-${b.revision}`)))) process.exitCode = 1;
