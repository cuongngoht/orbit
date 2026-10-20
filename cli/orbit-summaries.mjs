import { summaryOf } from "../src/task/summary.mjs";
import { taskView } from "../src/task/views.mjs";

export function summariesOf(tasks) {
  return tasks.list().map((id) => summaryLine(tasks, id));
}

function summaryLine(tasks, id) {
  try { return summaryOf(taskView(tasks.read(id))); }
  catch { return { id, lifecycle: "unknown" }; }
}
