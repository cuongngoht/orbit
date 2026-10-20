// What an intent is ABOUT: which system, which operation, which technology --
// read against the vocabulary THIS project's facts and the registered
// descriptors already use, never against a list in this file.
//
// "read-acme-ledger-entries" reaches the resolver as tokens. Which of them names a
// system is whatever an integration fact, a usage or a descriptor's domains
// call a system; which names an operation is whatever a usage calls one. A word
// neither knows is carried along and matches nothing -- the resolver then says
// the intent names nothing it can place, which is a true sentence.
import { tokens } from "../../tokens.mjs";

// Plural and singular are one operation: "list" asks about `lists`.
export const stem = (t) => String(t).toLowerCase().replace(/ies$/, "y").replace(/s$/, "");

export function parseIntent(text, world) {
  const asked = tokens(text);
  const stems = new Set(asked.map(stem));
  return { text: String(text ?? ""), asked, integration: systemOf(stems, world), operation: operationOf(stems, world), hint: hintOf(stems, world) };
}

// A system is named when EVERY token of its name is in the intent, so
// "acme ledger" names `acme-ledger` and "ledger" alone names nothing.
function systemOf(stems, world) {
  const named = systems(world).filter((s) => tokens(s.name).every((t) => stems.has(stem(t))) || s.aliases.some((a) => stems.has(stem(a))));
  return named.sort((a, b) => b.name.length - a.name.length)[0]?.name ?? null;
}

// Every system anything here calls one: integration and usage facts, and the
// domains a descriptor says its technology can serve -- with that descriptor's
// aliases, when it serves exactly one.
function systems(world) {
  const seen = world.facts.filter((f) => f.integration).map((f) => ({ name: f.integration, aliases: [] }));
  const known = world.descriptors.flatMap((d) => (d.domains ?? []).map((name) => ({ name, aliases: (d.domains ?? []).length === 1 ? d.aliases ?? [] : [] })));
  return [...seen, ...known];
}

// An operation is one a usage here performs, or one a registered analyser
// DECLARES it can demonstrate -- so "sites", which nothing here does yet, is
// still read as an operation, and the answer can say nobody implemented it.
function operationOf(stems, world) {
  const ops = [...new Set([...world.facts.filter((f) => f.operation).map((f) => f.operation), ...(world.operations ?? [])])];
  return ops.find((op) => stems.has(stem(op))) ?? null;
}

// A technology the intent names outright -- "with widgetkit" -- by id or alias.
function hintOf(stems, world) {
  const hit = world.descriptors.find((d) => stems.has(stem(d.id)) || (d.aliases ?? []).some((a) => stems.has(stem(a))));
  return hit?.id ?? null;
}

// A capability's id, in the same words: `acme.entry.get` is acme, entry,
// get; `acme.ledgerEntry.get` splits its camel case too.
export const capabilityWords = (id) => new Set(String(id).split(/[.\-_]/).flatMap((part) => part.split(/(?=[A-Z])/)).map(stem).filter(Boolean));
