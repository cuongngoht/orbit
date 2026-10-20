#!/usr/bin/env node
// Install what this project needs on THIS machine, then prove it worked.
//
//   node setup.mjs             show what is missing and what would be installed
//   node setup.mjs --install   actually install it
//
// Installing the plugin installs the ENGINE. The browser driver it steers is a
// separate npm package, and a database client is somebody else's software
// entirely -- so a plugin that installs cleanly could still fail at step 1 of
// the first case, somewhere that reads like a product defect.
//
// WHAT is needed comes from `query doctor`, which reads it off what the project
// declared. What can be INSTALLED is whatever carries a package name: the
// engine's own adapter does, a client a project pointed `sql.command` at does
// not, and this says so rather than pretending.
//
// Nothing is installed without --install. Exit 0 = everything usable, 2 = not.
import { doctorFindings } from "../src/query/doctor.mjs";
import { createContext } from "../src/run/context.mjs";

const INSTALL = process.argv.includes("--install");

function main() {
  const ctx = createContext();
  const missing = doctorFindings(ctx).filter((r) => !r.ok);
  if (!missing.length) return done("every tool this project needs is already usable here.");
  report(missing);
  finish(ctx, missing);
}

function report(missing) {
  console.log(`${missing.length} missing:\n`);
  for (const m of missing) console.log(`  ${m.what.padEnd(18)} ${m.detail}\n${manual(m)}`);
}

// A tool with a package name can be installed for you. One without is somebody
// else's software, and the only honest thing to offer is the reason and the fix.
const manual = (m) => (m.install ? `                     install: npm i -g ${m.install}` : `                     ${m.fix}`);

function finish(ctx, missing) {
  const installable = missing.filter((m) => m.install);
  if (!INSTALL) return plan(installable, missing);
  installable.forEach((m) => run(ctx, m));
  recheck(ctx);
}

function plan(installable, missing) {
  const names = installable.map((m) => m.install).join(", ");
  console.log(installable.length ? `\n--install would run: npm i -g ${names}` : "\nnothing here can be installed for you — see the fix above.");
  if (installable.length < missing.length) console.log(`${missing.length - installable.length} of them you have to install yourself.`);
  process.exit(2);
}

function run(ctx, m) {
  console.log(`\ninstalling ${m.install} …`);
  const r = ctx.tools.install(m.install);
  if (!r.ok) console.error(`  failed: ${r.why}`);
}

// The install is not the point; the tool being USABLE is. Asked again, the same
// way the engine will ask it, because on Windows a successful npm install still
// leaves a shim Node had to learn to unwrap.
function recheck(ctx) {
  const still = doctorFindings(ctx).filter((r) => !r.ok);
  if (!still.length) return done("\nevery tool this project needs is now usable here.");
  console.error(`\nstill missing: ${still.map((r) => r.what).join(", ")} — run \`query doctor\` for the detail.`);
  process.exit(2);
}

function done(said) {
  console.log(said);
  process.exit(0);
}

main();
