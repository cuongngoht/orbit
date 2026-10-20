import { StepError, trunc } from "../errors.mjs";

export default {
  name: "assert",
  label: (s) => trunc(s.why ?? s.js, 60),
  act(ctx, run, s) {
    if (!ctx.browser.truthy(s.js)) throw new StepError(`assert failed: ${s.why ?? s.js}`);
  },
};
