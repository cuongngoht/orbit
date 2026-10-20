# ADR 0009 — What a requirement says, kept apart from how it is built, and where it is read from

**Status:** accepted, 1.7.1

## Context
ADR 0007 settled whose word a requirement is and what a snapshot of a requirement FILE keeps. It
did not say how an item gets read from the system that owns it, what a requirement is once it is
read, or how a later session learns that it moved. Three things were missing:
- A way to read a work item without the engine knowing any product. A vendor's name in `src/` is
  a product learned, and a team that uses another vendor inherits the wrong one.
- A requirement kept as atomic, sourced statements, so that a revision changes only what it
  touches and an answer a person gave is not asked again.
- A line between what the business asked for and what the code happens to do. A model that fills
  a gap by reading the product has decided a requirement nobody decided.

## Decision
1. **Acquisition is provider-neutral.**
   - `src/sources/` knows a reader PORT (`resolves`, `read`), a descriptor SHAPE and a discovery
     LADDER. It names no provider, tool or vendor, and a test greps for that.
   - Provider knowledge is DATA in the pack `skills/orbit-requirements/` (`providers.json`) and
     the pack's readers. A reader is a resource in the one Effective Resource Registry: a managed
     MCP server, a pack reader over a connection, or a project's own capability.
   - The resolver that ranks everything else ranks them. Nothing here prefers a kind.
   - A missing reader is a gap: one knowledge opportunity per capability, and nothing is
     installed, enabled or generated.
2. **What is kept of a source is what it WAS.**
   - A record holds its identity, revision, digest, whose word it is, when it was read, its state
     and its relations as references. It never holds text.
   - The text goes to the caller once, as an untrusted envelope: scrubbed, bounded, and labelled
     as another system's data.
   - Two reads of one revision are one record. One revision whose content changed is an
     `anomaly`, reported, and nothing standing changes.
3. **A requirement is atomic facts.**
   - A fact is one statement about a SLOT, a subject and an aspect. Its `says` is a short
     restatement, masked and bounded, never a copy.
   - Its status comes from a table read by columns: stated, decided, derived, unknown, conflict,
     superseded. `decided` is a person's, and `unknown`, `conflict` and `superseded` are the
     engine's.
   - Its authority is derived on every read: a decided fact is accepted, any other is the weakest
     word among its sources. How CLEAR the requirement is (complete, partial, blocked) is a second
     thing, derived separately. A complete snapshot of a draft item is still a draft.
4. **Only a requirement-world source is a source.**
   - A source kind says whether it may bear authority. A work item, its criteria, its discussion
     and a document a person named do. A pull request, a commit, a test and the code do not.
   - `requirements record` refuses a citation of anything else, including a work receipt.
     Implementation evidence never settles what a requirement says.
5. **One door writes, in one order.**
   - `ingest` is the only caller of the fact and version writers, and a test greps for that.
   - Rules are an ordered table: refused, decided, confirm, restated, held, changed, rival, new.
     A decision is never overwritten by a source, and a revision that changes a slot keeps the
     version it replaced.
   - The journal line is written before the file it describes, and a crash between the two heals
     on the next open. Decisions, snapshots and superseded versions are write-once. `replay`
     re-derives the room from its journal and compares.
6. **The engine asks, and a person answers.**
   - A question is one per set of slots, and its proposed answer is a proposal.
   - The engine never answers. `answer`, `withdraw`, `bind` and `accept` take `--human`, which a
     playbook relays for words a person said.
   - An answered question stays answered unless a LATER revision of a source it depends on says
     something different about its slots; then that one reopens, and no other. Asking it again
     changes nothing, and neither does asking a withdrawn one: a host that repeats a question has
     learned nothing that reopens it, and must not be able to undo a person's word by repeating.
7. **A snapshot is immutable, and downstream work reads it by id.**
   - `rs-…` is a function of its content: two freezes of one state are one snapshot and write
     nothing.
   - `snapshotAsInput` turns it into the ADR 0007 input record (`type: pbi`, the snapshot's id,
     a short digest, its authority). Its authority is the snapshot's own, so an item a person
     accepted is accepted without being asked again. A person's `--authority=accepted --human`
     remains the one door that promotes a draft for one investigation.
   - A draft snapshot prepares tests and never confirms a finding.
8. **No migration.** `sources/`, `requirements/<root>/` and `work/` are rooms under the
   layout-3 store, created on first write and never on read. `store.json` is untouched.

## Consequences
- A new provider is a descriptor and a reader in a pack, or a project's own adapter. The engine
  does not change.
- Day 2 reads the store. An unchanged item costs no read, an answered question is not asked
  twice, and an adapter that exists is not built again.
- What a work item SAYS is never in a journal, a receipt, a trail event or a report. It cannot be
  redacted later because it was never kept.
