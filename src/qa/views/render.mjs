// The Markdown, from the JSON. Printed by default and written with --write, so
// the file people read is generated and nobody has to keep two shapes in step.
import { dirname, join } from "node:path";
import { planFor, MD_EXT } from "../load.mjs";
import { noPlan, out } from "../format.mjs";
import { planMarkdown } from "../markdown.mjs";
import { PLAN_FIELDS } from "../fields.mjs";
import { checkedId } from "../../store/id.mjs";
import { dataPath, editData } from "../../store/edit.mjs";
import { readFileSync, existsSync } from "node:fs";

export function render(ctx, args) {
  const ref = args.find((a) => !a.startsWith("--"));
  const p = ref ? planFor(ctx, ref) : null;
  if (!p) return noPlan(ref ?? "");
  return args.includes("--write") ? written(ctx, p) : out(planMarkdown(p));
}

// Beside the plan it renders, wherever that plan's screen folder is.
function written(ctx, p) {
  const file = dataPath(ctx.project, join(dirname(p._file), `${checkedId(p.id, PLAN_FIELDS.id)}${MD_EXT}`));
  const before = existsSync(file) ? readFileSync(file, "utf8") : null;
  editData(ctx.project, [{ file, before }], (io) => io.write(file, planMarkdown(p)));

  out(`wrote ${file}`);
}
