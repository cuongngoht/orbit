// Which technology each REGISTRATION reaches -- computed, never stored.
//
// A wiring fact is an observation of one composition root; a usage fact is an
// observation of one directory. Neither can say the other: that the class
// registered in one file is the class that holds the client in another is a
// relation BETWEEN two facts, and storing it on either would make a fact change
// when a scope it does not watch moves. So it is derived on every read, from
// two generic signals and no idiom at all:
//
//   the implementation is a type a usage's own evidence files DECLARE, or
//   the registration names a type the usage's signals include -- the client
//   itself registered directly.
//
// Same checkout only: a type called the same thing in another repository is
// another type.
const bare = (name) => String(name ?? "").replace(/<.*$/, "").split(".").at(-1);

function reaches(w, u) {
  const impl = bare(w.implementation);
  return w.root === u.root && ((impl && (u.defines ?? []).includes(impl)) || [bare(w.abstraction), impl].some((n) => n && (u.signals ?? []).includes(n)));
}

export const technologiesOf = (wiring, usages) => [...new Set(usages.filter((u) => reaches(wiring, u)).map((u) => u.technology))].sort();

// technology id -> every wiring fact that reaches it.
export function wiringLinks(facts) {
  const usages = facts.filter((f) => f.kind === "usage");
  const links = new Map();
  for (const w of facts.filter((f) => f.kind === "wiring")) for (const t of technologiesOf(w, usages)) links.set(t, [...(links.get(t) ?? []), w]);
  return links;
}
