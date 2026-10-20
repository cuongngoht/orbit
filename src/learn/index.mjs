// The command table. A command is (ctx, args) => void and prints its own view --
// the same shape src/query/index.mjs uses.
import { accept, applied, reject } from "./views/decide.mjs";
import { analyse } from "./views/analyse.mjs";
import { auto, where } from "./views/store.mjs";
import { forget, remember } from "./views/write.mjs";
import { lessons, recall, why } from "./views/lessons.mjs";

export const COMMANDS = {
  where,
  lessons,
  why,
  recall,
  remember,
  forget,
  auto,
  analyse,
  accept,
  reject,
  applied,
};

export const runLearn = (ctx, cmd, args) => COMMANDS[cmd](ctx, args);
