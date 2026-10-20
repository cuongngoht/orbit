import { join } from "node:path";
import { contained } from "../../project/boundary.mjs";

// `act` returns the PATH, and `logged` puts it in run-log.jsonl. Without that
// column the file was written where no reader could ever find it: the PNG
// existed, the log said nothing about it, and no report could show a picture a
// case had explicitly asked for.
export default {
  name: "screenshot",
  label: (s) => s.file,
  act: (ctx, run, s) => taken(ctx, contained(run.out, join(run.out, s.file))),
  logged: (r) => ({ screenshot: r.result }),
};

function taken(ctx, file) {
  ctx.browser.screenshot(file);
  return file;
}
