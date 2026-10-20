// Registered code is called through this and nothing else: a throw becomes a
// value with a short reason, so one analyser's bug costs one answer and says
// which -- the isolation src/architecture/analyzers/index.mjs gives its own
// table, for the same reason.
export function attempt(fn) {
  try {
    return { value: fn() };
  } catch (e) {
    return { error: String(e?.message ?? e).slice(0, 160) };
  }
}
