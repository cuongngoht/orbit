// An OS secret store in memory. `items` is inspectable, so a test can prove a
// credential reached the vault -- and, as importantly, nowhere else.
// `fail` makes every call throw, the way a locked keychain does.
export function fakeVault(opts = {}) {
  const items = new Map(Object.entries(opts.items ?? {}));
  const calls = [];
  const guard = (op, id) => {
    calls.push({ op, id });
    if (opts.fail) throw new Error(opts.fail);
  };
  return {
    id: opts.id ?? "fake-vault",
    items,
    calls,
    available: async () => !opts.unavailable,
    read: async (id) => (guard("read", id), items.get(id) ?? null),
    store: async (id, value) => (guard("store", id), items.set(id, value), undefined),
    remove: async (id) => (guard("remove", id), items.delete(id), undefined),
  };
}
