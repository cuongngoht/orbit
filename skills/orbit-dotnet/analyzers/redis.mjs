// Redis from C#, and -- the hard part -- NOT guessing what it is for.
//
// A connection multiplexer says Redis is used. It does not say whether as a
// cache, a session store, a lock or a queue, and every one of those is a
// different answer to "how does this project cache". So a connection alone is a
// usage with NO operation and an unknown saying why. Only the distributed-cache
// registration names a purpose outright, and only then is `cache` recorded; the
// cache abstraction on its own is a possible usage, since what backs it is
// configured somewhere else.
import { code, defines, found, hasNamespace, word } from "./csharp.mjs";

export const redis = {
  id: "dotnet.redis",
  ecosystem: "dotnet",
  doc: "Redis connections, and the distributed-cache registration that names a purpose",
  requires: ["redis"],
  extensions: [".cs"],
  operations: ["cache"],
  triggers: ["StackExchange.Redis", "IConnectionMultiplexer", "ConnectionMultiplexer", "IDistributedCache", "AddStackExchangeRedisCache"],
  analyze: ({ text }) => redisUsage(code(text)),
};

const PURPOSE_UNKNOWN = "what Redis is used for here — cache, session, lock or queue — the code opens a connection and does not say";

const BACKING_UNKNOWN = "whether this cache is backed by Redis — IDistributedCache is an abstraction, and what backs it is configured elsewhere";

// Ordered, and each row says what one kind of evidence proves. The cache
// abstraction only counts when nothing in the same file registers the cache
// outright -- that registration already says more.
const EVIDENCE = [
  { when: (c) => word(c, "AddStackExchangeRedisCache"), usage: () => ({ operation: "cache", confidence: "certain", signals: ["AddStackExchangeRedisCache"] }) },
  { when: (c) => hasNamespace(c, "StackExchange.Redis") || word(c, "IConnectionMultiplexer"), usage: (c) => ({ confidence: "certain", signals: found(c, /\bI?ConnectionMultiplexer\b|\bIDatabase\b/), unknowns: [PURPOSE_UNKNOWN] }) },
  { when: (c) => word(c, "IDistributedCache") && !word(c, "AddStackExchangeRedisCache"), usage: () => ({ operation: "cache", confidence: "possible", signals: ["IDistributedCache"], unknowns: [BACKING_UNKNOWN] }) },
];

function redisUsage(c) {
  const usages = EVIDENCE.filter((row) => row.when(c)).map((row) => ({ technology: "redis", integration: "redis", ...row.usage(c) }));
  return { defines: defines(c), usages };
}
