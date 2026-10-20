// What may be REGISTERED with project intelligence, as data: a technology
// descriptor, and a usage analyser -- plus the canonical shape an analyser
// hands back. The ecosystem adapter's contract is src/ecosystems/contract.mjs,
// a leaf, because the architecture reads manifests too.
//
// A DESCRIPTOR is knowledge about a technology: which packages mean it, what
// kind of thing it is, which systems it CAN serve. It is data, never code --
// adding a company's own SDK is a JSON file, not a module -- and it may never
// say what a project SHOULD use. "This client can reach that system" is a
// descriptor's to say; "this project uses it for that" is only ever read off the
// project's own code.
//
// An ANALYSER is the one place a language's or a library's idioms are known. It
// is PURE over one file it is handed -- `analyze({ path, text })` -- and never
// reads anything itself: the core finds the files through the source port, a
// bounded number of them, and passes each in. It returns canonical records, so
// nothing downstream of it ever learns the idiom it matched.

const SLUG = "^[a-z0-9][a-z0-9.-]*$";

export const DESCRIPTOR_FIELDS = {
  id: { type: "string", pattern: "^[a-z0-9][a-z0-9-]*$", doc: "The technology's id — what every fact about it carries as `technology`." },
  category: { type: "string", pattern: SLUG, doc: "What kind of thing it is: an sdk, a database, a cache, messaging, testing…" },
  provider: { type: "string", pattern: SLUG, doc: "Who publishes it." },
  doc: { type: "string", doc: "One line: what the technology is." },
  matchers: { type: "array", items: { type: "object" }, minItems: 1, doc: "Which declared dependencies mean this technology — each an { ecosystem, dependency } Specification; a trailing `*` matches a family." },
  domains: { type: "array", items: { type: "string" }, doc: "Which systems it CAN serve. Knowledge, never a choice." },
  aliases: { type: "array", items: { type: "string" }, doc: "Other names a person or a capability id uses for it." },
};

export const DESCRIPTOR_REQUIRED = ["id", "category", "matchers"];

export const MATCHER_FIELDS = {
  ecosystem: { type: "string", pattern: "^[a-z][a-z0-9-]*$", doc: "Which ecosystem's dependency names this matcher reads." },
  dependency: { type: "string", pattern: "^[^\\s]+$", doc: "The package name, case-insensitive; a trailing `*` matches every name that starts with what precedes it." },
};

export const MATCHER_REQUIRED = ["ecosystem", "dependency"];

export const ANALYZER_FIELDS = {
  id: { type: "string", pattern: "^[a-z][a-z0-9-]*(\\.[a-z][a-z0-9-]*)+$", doc: "Namespaced: <ecosystem>.<what it reads>." },
  ecosystem: { type: "string", pattern: "^[a-z][a-z0-9-]*$", doc: "Runs only in a checkout where this ecosystem has a unit." },
  doc: { type: "string", doc: "One line: what it can demonstrate." },
  requires: { type: "array", items: { type: "string" }, doc: "Technology ids, ANY of which must be declared in the checkout before this runs. Empty means it needs none." },
  extensions: { type: "array", items: { type: "string" }, minItems: 1, doc: "Which files it reads, by extension." },
  triggers: { type: "array", items: { type: "string" }, minItems: 1, doc: "Plain words whose presence makes a file worth reading. One search over the index finds them; nothing else is opened." },
  operations: { type: "array", items: { type: "string" }, doc: "The operations it can demonstrate, in the words its usages use — so an intent can name one that nothing in this project does yet, and be told so." },
};

export const ANALYZER_REQUIRED = ["id", "ecosystem", "doc", "extensions", "triggers"];

export const ANALYZER_METHODS = ["analyze"];

// What `analyze` returns, per file. Every array is optional.
export const USAGE_FIELDS = {
  technology: { type: "string", pattern: SLUG, doc: "The descriptor id the code touches." },
  integration: { type: "string", pattern: SLUG, doc: "The system reached, when the code names it." },
  operation: { type: "string", pattern: SLUG, doc: "What the code does, when the code says." },
  role: { type: "string", pattern: SLUG, doc: "producer, consumer, publisher or subscriber, when the code says." },
  confidence: { enum: ["certain", "possible"], doc: "certain when a namespace AND a type settle it; possible for a type name alone." },
  signals: { type: "array", items: { type: "string" }, doc: "The identifiers that settled it." },
  unknowns: { type: "array", items: { type: "string" }, doc: "What this file could not settle about it." },
};

export const USAGE_REQUIRED = ["technology"];

export const WIRING_FIELDS = {
  abstraction: { type: "string", pattern: "^[A-Za-z_][\\w.<>,`]*$", doc: "What it is asked for by." },
  implementation: { type: "string", pattern: "^[A-Za-z_][\\w.<>,`]*$", doc: "What answers it, when the code says." },
  lifetime: { type: "string", pattern: SLUG, doc: "How long one lives." },
  name: { type: "string", pattern: "^[A-Za-z0-9_.-]+$", doc: "Its own name, when it has one." },
  signals: { type: "array", items: { type: "string" }, doc: "The identifiers that settled it." },
};

export const WIRING_REQUIRED = ["abstraction", "lifetime"];

// A type name the evidence file declares -- identifier-shaped, so nothing
// else a file contains can ride out on it.
export const TYPE_NAME = /^[A-Za-z_][\w]*$/;
