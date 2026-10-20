import { trunc } from "../errors.mjs";
import { budgetOf, poll } from "../poll.mjs";

export default {
  name: "wait",
  label: (s) => trunc(s.js, 60),
  act: (ctx, run, s) => poll(ctx, s.js, budgetOf(ctx, run, s)),
};
