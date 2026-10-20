export function hasCycle(units) {
  const seen = new Set();
  const stack = new Set();
  const by = new Map(units.map((u) => [u.id, u]));
  return units.some((u) => cyclic(u.id, by, seen, stack));
}

function cyclic(id, by, seen, stack) {
  if (stack.has(id)) return true;
  if (seen.has(id)) return false;
  return walk(id, by, seen, stack);
}

function walk(id, by, seen, stack) {
  seen.add(id);
  stack.add(id);
  const hit = depsOf(by, id).some((d) => cyclic(d, by, seen, stack));
  stack.delete(id);
  return hit;
}

function depsOf(by, id) {
  return by.get(id)?.dependsOn ?? [];
}
