// How many runs a project keeps. The whole rule is here, pure, over data the
// caller hands in: keep the newest N; always keep the newest run, and always
// keep the run the newest render compared itself with, so the baseline a
// report names can still be opened. Everything else may go -- a run is
// evidence, and evidence is disposable once a newer one stands.
export function prunable(ids, { keep, protect = [] }) {
  const kept = new Set([...ids.slice(0, Math.max(1, keep)), ...protect]);
  return ids.filter((id) => !kept.has(id));
}

// The effect, separately: each pruned run's directory, and nothing else.
export function prune(room, io, ids, rule) {
  const gone = prunable(ids, rule);
  for (const id of gone) io.remove(room.run(id));
  return gone;
}
