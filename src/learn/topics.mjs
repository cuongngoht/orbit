// The topic files, AS DATA. Behaviour is a column, so a seventh topic costs one
// row and no file anywhere enumerates the six.
//
// `type` feeds the host's own `metadata.type` frontmatter field directly.
//
// `trigger` is the highest-leverage prose in this whole feature, and it is worth
// saying why: only MEMORY.md is inlined into a new session, and the topic files
// are read on demand by an agent deciding whether opening one is worth it. So the
// index line has to say WHEN TO READ THIS, not what it is. "Selectors that hold"
// gets skipped; "read before trusting a selector" gets opened.
export const TOPICS = [
  { id: "orbit-ui-selectors", type: "project", title: "Selectors that hold, and the ones that stopped", trigger: "read before trusting a selector or a map record on this product" },
  { id: "orbit-ui-failures", type: "project", title: "Failures that repeat, and what they turned out to be", trigger: "read before calling a failure a product bug" },
  { id: "orbit-ui-recovery", type: "project", title: "What happens after a failure here", trigger: "read when a run is BLOCKED or a verdict keeps flipping" },
  { id: "orbit-ui-drift", type: "project", title: "What changed under the tests", trigger: "read before trusting a case written at an older build" },
  { id: "orbit-ui-timing", type: "project", title: "How long this product actually takes", trigger: "read before blaming a slow run on the product" },
  { id: "orbit-ui-feedback", type: "feedback", title: "What people told us, and corrected", trigger: "read before repeating something a person already corrected" },
];

export const TOPIC_IDS = TOPICS.map((t) => t.id);

export const topicById = (id) => TOPICS.find((t) => t.id === id) ?? null;

export const isTopic = (id) => TOPIC_IDS.includes(id);
