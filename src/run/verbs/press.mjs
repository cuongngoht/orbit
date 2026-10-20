export default {
  name: "press",
  label: (s) => s.key,
  act: (ctx, run, s) => ctx.browser.press(s.key),
};
