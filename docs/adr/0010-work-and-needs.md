# ADR 0010 — A work is a journal of needs, and a need names a capability, never a provider

**Status:** accepted, 1.7.1

## Context
Settling a requirement is half of continuing a piece of work. The other half is remembering what
was being done about it: what has to be found out, proved or done, who could serve each, what they
answered, and what has moved since. A session rarely spans a day. A different model, on another
day, does the continuing, and it must pick up exactly where the last stopped without re-reading an
unchanged item, re-asking an answered question or rebuilding an adapter that exists.

Two shortcuts would have cost more than they saved: a second selector for "which provider serves
this need", and a work record that holds a server's name. Both make a work break the day a server
is switched off.

## Decision
1. **One work per requirement, and it is a journal.**
   - Its id is its requirement's root id spelled for work, so "continue PBI 4312" is the same
     work on every host and every day.
   - The journal is append-only, filtered per kind by an allow-list, scrubbed on the way in, and
     carries a schema. A newer one is refused, never read with records dropped.
   - Every view is a fold over it. Nothing is stored beside it.
2. **A need names a capability.**
   - A need is a proof, a piece of knowledge to find out, or an action to do, with a rank. A
     proof or a piece of knowledge names the capability that could serve it, such as
     `documentation.search`, and never a server, a tool or a URL.
   - It may depend on requirement facts its adopted snapshot lists, and on needs proposed before
     it, so the graph has no forward edge and no cycle.
   - Its state is derived by an ordered table: stale, not applicable, satisfied, blocked, pending.
     The frontier is the pending needs whose dependencies are met, in rank order.
3. **A binding says who serves it today.**
   - Resolution goes to the resolver that already exists (`knowledge/verify.mjs`), which walks
     the requirement graph and the ordered selector the prompt router uses. Nothing here selects.
   - A binding holds the provider's kind and key and a fingerprint of everything that makes it
     eligible. A provider's identity is its KIND AND its key: a skill and an agent of one plugin
     share a key, so a lookup by key alone finds the wrong one.
   - When the fingerprint no longer holds, the binding has moved, and the need is resolved
     again. The need itself does not change.
4. **Invalidation is by dependency.**
   - An ordered table finds what moved: a fact the need depends on (adopted snapshot against the
     newest), the provider it was bound to, the files it is about (hashed when it was settled).
   - Only the dependents go stale. A stale line is written once per `from`, so settling a need
     again and finding the same fact at the same revision does not stale it a second time.
   - Resuming never adopts a newer snapshot. Adopting one is a choice.
5. **A provider is asked through the gates that exist.**
   - A managed server is reached only through the MCP broker, and a project's capability only
     through the capability pipeline, with no page and no case. A host's server is never called,
     and a binding that names one is refused before the broker can be handed a managed server of
     the same name.
   - A receipt keeps the need, the provider, the tool, a digest of what was asked, a digest of
     what came back, where the answer said it came from, and how it ended. A refusal or a block
     is a receipt too. The answer is printed once, scrubbed and bounded, and kept nowhere.
6. **What a work learned is knowledge, and never a requirement.**
   - `work-receipt` is a stamped knowledge source: never verified, never above what an
     observation may be, and never typed in. The host says what an answer means; the engine
     supplies the source, the reference to the receipt and the strength.
   - An answer that named where it came from is an observation. One that named nothing is a
     suggestion. Knowledge derives the rest.
7. **Stopping is a checkpoint.** It looks again at what moved, binds what must be bound, then
   writes the frontier, so the frontier a later session reads is never a stale one.

## Consequences
- A server disabled between sessions costs one re-resolve, and only for the needs bound to it.
- A need that depended on a fact that moved is stale and waits for new evidence; one that did not
  is untouched.
- `work-receipt` claims are hints to the next session about how to build, earned like every other
  claim by independent sessions. They are never a reason to change what a requirement says.
