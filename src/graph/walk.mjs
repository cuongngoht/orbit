// The two walks over the map that every reader shares: what a screen's surface
// is, and the shortest click-path between two screens.
import { edgeKey } from "./load.mjs";

// A "screen" to QC means the route plus every dialog, wizard tab and row menu
// it opens -- nodes with no url of their own. The walk stops at anything
// addressable, which is a different screen in its own right.
export function surface(graph, id) {
  const seen = new Set([id]);
  const queue = [id];
  while (queue.length) enqueueSubsurfaces(graph, queue.shift(), seen, queue);
  return seen;
}

function enqueueSubsurfaces(graph, from, seen, queue) {
  for (const e of outgoing(graph, from)) {
    if (seen.has(e.to) || graph.screens.get(e.to)?.url) continue;
    seen.add(e.to);
    queue.push(e.to);
  }
}

const outgoing = (graph, from) => graph.edges.filter((e) => e.from === from && e.to);

export function screenControls(graph, id) {
  const on = surface(graph, id);
  return graph.edges.filter((e) => on.has(e.from));
}

export function screenEffects(graph, id) {
  return screenControls(graph, id).map((e) => graph.effectOn.get(edgeKey(e))).filter(Boolean);
}

// Shortest click-path as [{ at, e }], for printing, scripting or driving alike.
export function route(graph, from, to) {
  const prev = bfs(graph, from, to);
  if (!prev.has(to)) return null;
  return unwind(prev, to);
}

function bfs(graph, from, to) {
  const prev = new Map([[from, null]]);
  const queue = [from];
  while (queue.length && !prev.has(to)) expand(graph, queue.shift(), prev, queue);
  return prev;
}

function expand(graph, at, prev, queue) {
  for (const e of outgoing(graph, at)) {
    if (prev.has(e.to)) continue;
    prev.set(e.to, { at, e });
    queue.push(e.to);
  }
}

function unwind(prev, to) {
  const steps = [];
  for (let cur = to; prev.get(cur); cur = prev.get(cur).at) steps.unshift(prev.get(cur));
  return steps;
}
