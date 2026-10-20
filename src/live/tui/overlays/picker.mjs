// The TASK PICKER (`t`): projects and checkouts as the registry knows them, each opened checkout's tasks from
// their journals' first and last lines (tree.mjs). It chooses what is SHOWN; it starts, stops and approves
// nothing.
import { pickerItems, viewsOf } from "../tree.mjs";
import { dim, joined, row, seg } from "../sections/parts.mjs";

const AMBIGUOUS = (state) => (state.association.how === "ambiguous" ? seg(`${state.association.ids.length} tasks run in this checkout: pick the one to show`, "warning") : !state.place ? seg("not a Orbit checkout yet: a task started here is shown by itself", "info") : state.association.how === "none" && !state.root ? seg("no task here yet: one started here is shown by itself", "info") : null);

const counted = (c) => (c ? joined([seg(`${c.running} running`, c.running ? "info" : "subtle"), dim(`${c.ended} ended`), c.waiting ? seg(`${c.waiting} waiting for a person`, "warning") : null, c.blocked ? seg(`${c.blocked} blocked or paused`, "warning") : null, c.unknown ? dim(`${c.unknown} not read`) : null]) : [dim("tasks not read yet")]);

const lifeOf = (state, item) => viewsOf(state)[item.task]?.lifecycle ?? (item.row.missing ? "not among this checkout's recent tasks" : item.row.terminal ? "ended" : "running");

const ITEM_ROWS = {
  project: (state, item) => row([seg(item.project.name ?? item.key, "label"), dim(`  ${item.key}`)]),
  checkout: (state, item) => row([seg(`  ${item.open ? "▾" : "▸"} `), seg(item.checkout.summary?.branch ?? item.checkoutId.slice(0, 12)), dim(`  ${item.checkout.root ?? ""}`), seg("   "), ...counted(item.counts), item.checkoutId === state.place?.checkoutId ? dim("   (here)") : null]),
  task: (state, item) => row([seg("  ".repeat(item.depth)), seg(item.task, item.task === state.root ? "brand" : undefined), dim(item.row.coordinates ? "  workflow" : item.depth === 3 ? "  engineering task" : "  task"), seg(`  ${lifeOf(state, item)}`, item.row.terminal ? "subtle" : "info"), item.task === state.root ? dim("   ← shown") : null]),
};

export function pickerOverlay(state) {
  const items = pickerItems(state);
  return { title: "TASKS", lead: [row(joined([AMBIGUOUS(state), dim("projects and checkouts this machine knows")]))], rows: items.map((item) => ITEM_ROWS[item.kind](state, item)), selectable: true };
}
