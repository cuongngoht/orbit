// The command table -- src/architecture/index.mjs's shape. `writes` is a
// COLUMN so the test proving no intelligence command touches the repository it
// reads iterates the table, and a command added later is covered by its row.
// `propose` writes to ENGINEERING memory, and only through engineering's door.
import { dependencies, ecosystems, integrations, technologies, wiring } from "./views/catalog.mjs";
import { ensure } from "./views/ensure.mjs";
import { facts, why } from "./views/facts.mjs";
import { propose } from "./views/propose.mjs";
import { resolveView } from "./views/resolve.mjs";
import { descriptors, where } from "./views/store.mjs";

export const COMMANDS = {
  ensure: { run: ensure, writes: "store" },
  scan: { run: (ctx, args) => ensure(ctx, [...args, "--rescan"]), writes: "store" },
  facts: { run: facts, writes: "nothing" },
  why: { run: why, writes: "nothing" },
  ecosystems: { run: ecosystems, writes: "nothing" },
  dependencies: { run: dependencies, writes: "nothing" },
  technologies: { run: technologies, writes: "nothing" },
  integrations: { run: integrations, writes: "nothing" },
  wiring: { run: wiring, writes: "nothing" },
  resolve: { run: resolveView, writes: "nothing" },
  propose: { run: propose, writes: "engineering" },
  descriptors: { run: descriptors, writes: "nothing" },
  where: { run: where, writes: "nothing" },
};

export const COMMAND_NAMES = Object.keys(COMMANDS);

export const runIntelligence = (ctx, cmd, args) => COMMANDS[cmd].run(ctx, args);
