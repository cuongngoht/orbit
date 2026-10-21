// The command table. A command is (ctx, args) => void and prints its own view --
// the same shape src/query/index.mjs and src/learn/index.mjs use.
import { capabilities, diff, where } from "./views/store.mjs";
import { ensure } from "./views/ensure.mjs";
import { facts, why } from "./views/facts.mjs";
import { graph } from "./views/graph.mjs";
import { projectInto } from "./views/project.mjs";
import { record } from "./views/record.mjs";

// `writes` is on the table rather than in each command, so the test that proves
// no architecture command touches the consuming repository can iterate the
// table -- and a command added later is covered by its own row rather than by
// somebody remembering to add it to a list in a test.
export const COMMANDS = {
  ensure: { run: ensure, writes: "store" },
  scan: { run: (ctx, args) => ensure(ctx, [...args, "--rescan"]), writes: "store" },
  facts: { run: facts, writes: "nothing" },
  why: { run: why, writes: "nothing" },
  graph: { run: graph, writes: "nothing" },
  capabilities: { run: capabilities, writes: "nothing" },
  diff: { run: diff, writes: "nothing" },
  where: { run: where, writes: "nothing" },
  record: { run: record, writes: "store" },
  project: { run: projectInto, writes: "nothing" },
};

export const COMMAND_NAMES = Object.keys(COMMANDS);

export const runArchitecture = (ctx, cmd, args) => COMMANDS[cmd].run(ctx, args);
