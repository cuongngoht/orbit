import { trunc } from "../errors.mjs";

export default {
  name: "click",
  label: (s) => s.via ?? trunc(s.selector, 50),
  act: (ctx, run, s) => ctx.browser.click(s.selector),
};
