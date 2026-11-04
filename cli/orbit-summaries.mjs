import { modelOf } from "../src/task/model.mjs";
import { summaryOf } from "../src/task/summary.mjs";
import { taskView } from "../src/task/views.mjs";

// One line per task, read off its journal folded into a model -- the view needs the model, never the raw records.
export function summariesOf(tasks, now = new Date().toISOString()) {
  return tasks.list().map((id) => summaryLine(tasks, id, now));
}

function summaryLine(tasks, id, now) {
  try { return summaryOf(taskView(modelOf(tasks.read(id)), now)); }
  catch { return { id, lifecycle: "unknown" }; }
}
