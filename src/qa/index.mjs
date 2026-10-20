// The command table. A command is (ctx, args) => void and prints its own view --
// the same shape src/query/index.mjs and src/learn/index.mjs use.
//
// `check` is not here. A gate belongs in its own CLI with its own exit-code
// contract (cli/plan-check.mjs), so nothing that prints a view can accidentally
// decide whether a build fails.
import { coverage } from "./views/coverage.mjs";
import { impact } from "./views/impact.mjs";
import { plans } from "./views/plans.mjs";
import { render } from "./views/render.mjs";
import { scaffold } from "./views/scaffold.mjs";
import { select } from "./views/select.mjs";
import { show } from "./views/show.mjs";
import { suggest } from "./views/suggest.mjs";

export const COMMANDS = {
  plans,
  show,
  render,
  coverage,
  select,
  impact,
  suggest,
  new: scaffold,
};

export const runQaPlan = (ctx, cmd, args) => COMMANDS[cmd](ctx, args);
