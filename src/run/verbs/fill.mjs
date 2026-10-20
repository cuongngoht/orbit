import { trunc } from "../errors.mjs";

export default {
  name: "fill",
  label: (s) => `${s.via ?? trunc(s.selector, 30)} = ${s.value}`,
  act: (ctx, run, s) => ctx.browser.fill(s.selector, s.value),
};
