// The SHAPE of what a reader returns and of a source's identity, declared once and
// enforced from the declaration by src/constraints.mjs -- the discipline every
// other field table in this engine keeps.
//
// A work item's TEXT is untrusted data from an external system. The table says what
// a reader may hand back; nothing here decides what the text means, and nothing that
// is validated here is ever stored as text (model.mjs keeps a digest).
import { SOURCE_KIND_NAMES } from "./contract-v1.mjs";

// A provider, as a descriptor names it: a lowercase slug.
export const PROVIDER = "^[a-z][a-z0-9-]{0,47}$";

// An organization or a project as its own system spells it. Real ones carry capitals
// and spaces, so it is a NAME, not a slug; hashing lowercases it (model.mjs).
export const NAME = "^[A-Za-z0-9][A-Za-z0-9 ._-]{0,99}$";

// An item's id inside its system.
export const ITEM_ID = "^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$";

export const IDENTITY_FIELDS = {
  provider: { type: "string", pattern: PROVIDER, doc: "Which kind of system holds the item, as a descriptor names it." },
  organization: { type: "string", pattern: NAME, doc: "The organization or owner inside that system." },
  project: { type: "string", pattern: NAME, doc: "The project or repository inside the organization. Absent when the system has none." },
  id: { type: "string", pattern: ITEM_ID, doc: "The item's id inside that project." },
};

export const IDENTITY_REQUIRED = ["provider", "organization", "id"];

export const COMMENT_FIELDS = {
  id: { type: "string", doc: "The comment's id in its system." },
  at: { type: "string", doc: "When it was written, as the system spells it." },
  by: { type: "string", doc: "Who wrote it. A masked name: it is never used to decide anything." },
  text: { type: "string", doc: "What it says. Untrusted data." },
};

export const RELATED_FIELDS = {
  ref: { type: "string", pattern: ITEM_ID, doc: "The related item's id, in the same organization and project as this one." },
  relation: { type: "string", enum: ["parent", "child", "related", "implements"], doc: "How it relates, in the engine's four words." },
  kind: { type: "string", enum: SOURCE_KIND_NAMES, doc: "What it is. Absent reads workitem." },
};

export const REVISION_FIELDS = {
  revision: { type: "string", doc: "A revision the item has had." },
  at: { type: "string", doc: "When, as the system spells it." },
};

// What a reader returns for one work item. `body` and `acceptance` are TEXT and stay
// in the envelope a person or a model reads; the store keeps their digest.
export const WORKITEM_FIELDS = {
  ref: { type: "string", pattern: ITEM_ID, doc: "The item's id as its system spells it." },
  provider: { type: "string", pattern: PROVIDER, doc: "Which kind of system answered." },
  type: { type: "string", doc: "The item's own type, in its system's words." },
  title: { type: "string", doc: "The item's title. Untrusted data." },
  state: { type: "string", doc: "The item's own state, in its system's words." },
  revision: { type: "string", doc: "The item's revision. A string, whatever the system counts in." },
  url: { type: "string", doc: "Where a person opens it." },
  updatedAt: { type: "string", doc: "When it last changed, as the system spells it." },
  body: { type: "string", doc: "The description. Untrusted data, never stored." },
  acceptance: { type: "string", doc: "The acceptance criteria. Untrusted data, never stored." },
  comments: { type: "array", doc: "The discussion, oldest first: objects of COMMENT_FIELDS." },
  parent: { type: "string", pattern: ITEM_ID, doc: "The parent item's id." },
  children: { type: "array", items: { type: "string" }, doc: "The children's ids." },
  related: { type: "array", doc: "Other linked items: objects of RELATED_FIELDS." },
  revisions: { type: "array", doc: "The revisions it has had: objects of REVISION_FIELDS." },
};

export const WORKITEM_REQUIRED = ["ref", "provider", "revision", "title"];

// What of a work item is CONTENT: what a change to it would mean for the requirement.
// The digest is over exactly these, so a revision counter that did not move while the
// content did is visible.
export const CONTENT_FIELDS = ["title", "body", "acceptance", "comments", "parent", "children", "related"];
