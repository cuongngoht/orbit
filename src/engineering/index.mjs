// The command table -- src/architecture/index.mjs's identical shape, over the
// second subject. `writes` is a column rather than something each command
// says for itself, so the test proving no engineering command touches the
// consuming repository can iterate this table: a command added later is
// covered by its own row, never by somebody remembering to extend a list.
import { facts, why } from "./views/facts.mjs";
import { record } from "./views/record.mjs";
import { where } from "./views/store.mjs";
import { ensure } from "./views/ensure.mjs";
import { recallView } from "./views/recall.mjs";
import { journal, replay } from "./views/journal.mjs";
import { observe } from "./views/observe.mjs";
import { doctor } from "./views/doctor.mjs";

export const COMMANDS = {
  doctor: { run: doctor, writes: "nothing" },
  facts: { run: facts, writes: "nothing" },
  why: { run: why, writes: "nothing" },
  record: { run: record, writes: "store" },
  where: { run: where, writes: "nothing" },
  ensure: { run: ensure, writes: "store" },
  recall: { run: recallView, writes: "nothing" },
  journal: { run: journal, writes: "nothing" },
  replay: { run: replay, writes: "nothing" },
  observe: { run: observe, writes: "store" },
};

export const COMMAND_NAMES = Object.keys(COMMANDS);

export const runEngineering = (ctx, cmd, args) => COMMANDS[cmd].run(ctx, args);
