# ADR 0035 — The Orbit Adapter Protocol

## Status

Proposed (0.1.0). Extends ADR 0034, the resolver (`src/routing/`) and the knowledge opportunity rule.

## Context

1. **Orbit cannot know a project's stack, nor write a client for every option.** A consuming project may use any
   broker, scheduler, store or identity system: an AMQP broker, a log broker, a cloud queue, a database-backed job
   table, an in-process scheduler, a cluster job scheduler.
2. **What a project uses is discoverable; what a technology guarantees is not.** Intelligence packs already recognise
   several messaging clients (`skills/orbit-dotnet/analyzers/messaging.mjs`), and `catalog/runtimes.json` services name
   service images and ports. Assuming the guarantees is how a test passes on a guess.
3. **Proof does not travel between transports.** A queue adapter's semantics do not prove a log broker's, and a test
   that passes on one transport says nothing about another.

## Decision

- **Families of generic operations.**
  - `src/adapters/families.mjs` declares the families: http, messaging, job, scheduler, schedule, clock, workload,
    worker, state, observe, fixture, identity. Rpc, batch, stream, workflow, webhook and file are contract only in
    0.1.0.
  - Each operation declares:
    - the ref kinds it binds;
    - its effect: none, read, write, publish, enqueue, trigger, consume, settle, create-resource, delete-resource,
      advance-clock, control-workload or replay;
    - an output allow-list with `means`;
    - the semantics fields it depends on.
  - `src/adapters/core.mjs` registers them as `orbit.<family>.<op>` capabilities, with page false and `mutates`
    derived from the effect. A case names a family operation and logical refs, never an adapter.
- **An adapter is a declaration and a helper.**
  - The declaration is `orbit.adapter/v1` (`src/adapters/contract-v1.mjs`): id, family, transports (tokens that
    discovery or a pack sets), operations, semantics, limits and conformance parameters. It is validated before
    anything registers.
  - The helper is any executable, in any language, using the technology's own SDK, CLI or API, and speaking
    `orbit.helper/v1` (ADR 0036). It runs on the host, in the isolated worker, or in an image of its own that is pinned
    by digest and trusted by fingerprint.
  - The adapter's dependencies are its own and never reach Orbit's `package.json`.
- **Semantics are vocabulary data**, layered like topology: plugin → organisation → project. Fields: delivery,
  publishAck, publishDedupe, consumerAck, redeliveryTriggers, orderingScope, deadLetter, retryLimit, observation
  (shadow-subscription, independent-cursor, read-only-query, none), replay, leaseMinSec, clockInjection and schedule
  dialects. `unknown` is legal everywhere and switches off only the features that need that field.
- **Selection is dynamic and ordered** (`src/adapters/select.mjs`). A candidate adapter must, in order:
  1. match the transport the binding gives (from discovery: intelligence, runtime services, the graph);
  2. declare the operation;
  3. declare semantics that meet the obligation's needs;
  4. be active and allowed by the resource registry and policy.

  Ties are broken by trust, then by a stable id. The last row answers BLOCKED with a CAPABILITY_MISSING gap scoped to
  the BOUNDARY it costs: a state witness still runs when delivery evidence cannot. It also records one knowledge
  opportunity per family operation. There is never a fallback to another transport, an emulator or a fake.
- **Conformance kits.** `skills/orbit-adapter-kit/kits/<family>.json` holds generic scenarios, selected by the semantics
  an adapter declares. They run through the family operations against the real dependency in the sandbox, with a
  witness that is not the adapter. Receipts are kept under `<store>/adapters/<id>/<fingerprint>/`.
- **Support is computed.** `query adapters --matrix` derives supported, partial or unsupported per family × adapter ×
  transport × operation × feature, from declarations and kit receipts for the current fingerprint and source digest.
  A pass on an emulator is never supported, and no file states a level by hand.
- **A project extends it.** `qc-tool new <id> <dir> --family --transport --lang` scaffolds a draft adapter whose
  semantics are all `unknown`, with its kit configuration. Only `qc-tool register --human` activates one, and nothing
  generated activates itself.
- **The shipped adapters are examples.** The reference adapters ship as packs: one for AMQP 0-9-1 and one for NATS
  JetStream, structurally different on observation, leases, dedupe and dead-lettering. They exist to prove the protocol
  is not shaped after one broker. Their profiles, and the vendor documentation those cite, live in their packs.

## Consequences

- Nothing under `src/adapters/` names a product, and a test greps for it.
- A project on a technology with no adapter still gets its obligations, its state-level checks and a precise gap.
