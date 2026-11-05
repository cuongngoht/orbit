# Worked designs, one per obligation shape

One generic design for every shape the engine designs a test for, each one a `generate` action's `design` that the
engine made a draft of: `test/qa-worked-designs.test.mjs` holds every one of them to the engine's own validator for its
shape -- the same generation port your design goes through. Read the one for your obligation's shape before your first
`generate`, and write yours the same way. What is the example's and never yours:

- **The aliases** (`orders-api`, `order-events`, `fulfilment`, `orders-table`, `nightly-settle`, `shop`, `owner`,
  `stranger` ...) belong to the example's system. Yours are the ones `context` lists under `bindings`, exactly as they
  are written there -- and a workload's fault points are the ones listed beside it (`points`).
- **The accepted slots** (`accepted`) are what the example assumes its plan states. Yours are your plan's: assert each
  of your obligation's own slots (its template's `expected`) on the step whose answer carries it, with the template its
  op compiles to (`eq` is `value-eq`, `in` `value-in`, `contains` `value-includes`, `excludes` `value-excludes`,
  `present` `value-present`, `ordered` `order-eq`, `complete-within` `complete`, `absent-within` `absent-within`).
  A slot stated `for: []` is an auxiliary one: a design may rule a barrier or a control's step with it.
- **`obligation`** is your obligation's id, from the frontier; **`criterion`** names the example's criterion whose
  obligation the design serves. Neither is sent but `obligation`.

What every design shows, whatever its shape: the steps carry no `expect`, `js`, `wait` or `status` (the engine compiles
every verdict); every `call` is ruled on -- by an assertion, as a fault control's witness, or (a trigger, a publication, an
armed observer, a clock move, a workload control) by what its own operation's answer shows when it was taken; a window
comes from the slot's `within`, never a `waitMs` of yours, unless the step is a fault control's witness, which waits within
its own bound; an observer is armed by a step before the trigger, and every await asks the observer it armed, by a
message id or a correlation; a request carries only the fields its adapter reads; a fault's workload is brought back
after the fault's witness and before anything asks it for more. Business keys, message ids and occurrences are each
test's own: no other test of the investigation uses them.

Shapes only a contract represents -- `batch-partial-failure`, `stream-late-events`, `workflow-compensation`,
`webhook-authenticity`, `file-integrity` -- have no adapter and no oracle yet: an obligation of one is a counted gap,
never designed.

## Synchronous

### response-conforms

A positive control, slots ruled with `value-eq`, `value-in` or `schema-valid`. The interface's answer is read as an
approved identity; a documented error is read the same way, ruled by auxiliary slots.

```json
{
  "shape": "response-conforms",
  "criterion": "ORD-1",
  "accepted": {
    "ORD-1/E1": { "property": "response.status", "op": "eq", "value": 200 },
    "ORD-1/E2": { "property": "response.body.currency", "op": "in", "value": ["EUR", "USD"] },
    "ORD-1/E3": { "property": "response.status", "op": "eq", "value": 404, "for": [] },
    "ORD-1/E4": { "property": "response.body.error", "op": "eq", "value": "not_found", "for": [] }
  },
  "design": {
    "obligation": "tob-000000000000",
    "skeleton": { "steps": [
      { "do": "call", "capability": "orbit.http.read", "input": { "endpointRef": "orders-api", "identityRef": "owner", "method": "GET", "path": "/orders/ord-1001", "headers": { "accept": "application/json" } } },
      { "do": "call", "capability": "orbit.http.read", "input": { "endpointRef": "orders-api", "identityRef": "owner", "method": "GET", "path": "/orders/ord-1001-missing", "headers": { "accept": "application/json" } } }
    ] },
    "assertions": [
      { "criterionRef": "ORD-1/E1", "template": "value-eq", "step": 1 },
      { "criterionRef": "ORD-1/E2", "template": "value-in", "step": 1 },
      { "criterionRef": "ORD-1/E3", "template": "value-eq", "step": 2 },
      { "criterionRef": "ORD-1/E4", "template": "value-eq", "step": 2 }
    ],
    "controls": [{ "role": "positive", "identityRef": "owner", "why": "the order's owner may read it" }],
    "trigger": { "kind": "interface", "ref": "orders-api", "step": 1 },
    "effectScope": "fixture"
  }
}
```

### permission-enforced

A positive AND a negative control, as two different identities: a refusal of the allowed actor proves nothing about
anybody else. The allowed read comes first; then the actor without the right, reading and writing.

```json
{
  "shape": "permission-enforced",
  "criterion": "ACL-3",
  "accepted": {
    "ACL-3/E1": { "property": "response.status", "op": "eq", "value": 404 },
    "ACL-3/E2": { "property": "response.body", "op": "excludes", "value": "ord-3003-private-note" },
    "ACL-3/E3": { "property": "response.status", "op": "eq", "value": 200, "for": [] },
    "ACL-3/E4": { "property": "response.status", "op": "in", "value": [403, 404], "for": [] }
  },
  "design": {
    "obligation": "tob-000000000000",
    "skeleton": { "steps": [
      { "do": "call", "capability": "orbit.http.read", "input": { "endpointRef": "orders-api", "identityRef": "owner", "method": "GET", "path": "/orders/ord-3003" } },
      { "do": "call", "capability": "orbit.http.read", "input": { "endpointRef": "orders-api", "identityRef": "stranger", "method": "GET", "path": "/orders/ord-3003" } },
      { "do": "call", "capability": "orbit.http.write", "input": { "endpointRef": "orders-api", "identityRef": "stranger", "method": "PATCH", "path": "/orders/ord-3003", "body": { "note": "changed by someone else" } } }
    ] },
    "assertions": [
      { "criterionRef": "ACL-3/E3", "template": "value-eq", "step": 1 },
      { "criterionRef": "ACL-3/E1", "template": "value-eq", "step": 2 },
      { "criterionRef": "ACL-3/E2", "template": "value-excludes", "step": 2 },
      { "criterionRef": "ACL-3/E4", "template": "value-in", "step": 3 }
    ],
    "controls": [
      { "role": "positive", "identityRef": "owner", "why": "the owner reads it, so the refusals below are about the stranger alone" },
      { "role": "negative", "identityRef": "stranger", "why": "a user of another tenant is refused, reading and writing alike" }
    ],
    "trigger": { "kind": "interface", "ref": "orders-api", "step": 2 },
    "effectScope": "fixture"
  }
}
```

### fields-restricted

A positive and a negative control as two identities: the one allowed to see the field sees it; the one who may not gets
an answer without it -- even when both ask for the order's full view.

```json
{
  "shape": "fields-restricted",
  "criterion": "FLD-4",
  "accepted": {
    "FLD-4/E1": { "property": "response.body", "op": "excludes", "value": "internalCost" },
    "FLD-4/E2": { "property": "response.status", "op": "eq", "value": 200, "for": [] },
    "FLD-4/E3": { "property": "response.body.internalCost", "op": "present", "for": [] }
  },
  "design": {
    "obligation": "tob-000000000000",
    "skeleton": { "steps": [
      { "do": "call", "capability": "orbit.http.read", "input": { "endpointRef": "orders-api", "identityRef": "manager", "method": "GET", "path": "/orders/ord-4004", "query": { "view": "full" } } },
      { "do": "call", "capability": "orbit.http.read", "input": { "endpointRef": "orders-api", "identityRef": "clerk", "method": "GET", "path": "/orders/ord-4004", "query": { "view": "full" } } }
    ] },
    "assertions": [
      { "criterionRef": "FLD-4/E2", "template": "value-eq", "step": 1 },
      { "criterionRef": "FLD-4/E3", "template": "value-present", "step": 1 },
      { "criterionRef": "FLD-4/E2", "template": "value-eq", "step": 2 },
      { "criterionRef": "FLD-4/E1", "template": "value-excludes", "step": 2 }
    ],
    "controls": [
      { "role": "positive", "identityRef": "manager", "why": "a manager may see what the order cost" },
      { "role": "negative", "identityRef": "clerk", "why": "a clerk reads the order and never its cost" }
    ],
    "trigger": { "kind": "interface", "ref": "orders-api", "step": 1 },
    "effectScope": "fixture"
  }
}
```

## State

### no-foreign-effect

Positive, negative and state controls: the owner's read works, another tenant's write is refused, and what is stored
below shows nothing of that tenant.

```json
{
  "shape": "no-foreign-effect",
  "criterion": "TEN-5",
  "accepted": {
    "TEN-5/E1": { "property": "effect.count", "op": "count-eq", "value": 1 },
    "TEN-5/E2": { "property": "effect.value", "op": "excludes", "value": "tenant-b" },
    "TEN-5/E3": { "property": "response.status", "op": "eq", "value": 200, "for": [] },
    "TEN-5/E4": { "property": "response.status", "op": "in", "value": [403, 404], "for": [] }
  },
  "design": {
    "obligation": "tob-000000000000",
    "skeleton": { "steps": [
      { "do": "call", "capability": "orbit.http.read", "input": { "endpointRef": "orders-api", "identityRef": "owner", "method": "GET", "path": "/orders/ord-5005" } },
      { "do": "call", "capability": "orbit.http.write", "input": { "endpointRef": "orders-api", "identityRef": "stranger", "method": "PUT", "path": "/orders/ord-5005", "body": { "tenantId": "tenant-b", "total": 0 } } },
      { "do": "call", "capability": "orbit.state.read", "input": { "stateRef": "orders-table", "request": { "key": "ord-5005", "limit": 5 } } }
    ] },
    "assertions": [
      { "criterionRef": "TEN-5/E3", "template": "value-eq", "step": 1 },
      { "criterionRef": "TEN-5/E4", "template": "value-in", "step": 2 },
      { "criterionRef": "TEN-5/E1", "template": "count-eq", "step": 3 },
      { "criterionRef": "TEN-5/E2", "template": "value-excludes", "step": 3 }
    ],
    "controls": [
      { "role": "positive", "identityRef": "owner", "why": "the owner's own order is there to be changed" },
      { "role": "negative", "identityRef": "stranger", "why": "another tenant's write is refused" },
      { "role": "state", "why": "one row, and nothing of the other tenant in it" }
    ],
    "trigger": { "kind": "interface", "ref": "orders-api", "step": 2 },
    "effectScope": "fixture"
  }
}
```

### persisted-after-write

A positive and a state control: a write the interface accepted is read back below it -- a screen or an answer can show a
write that never happened.

```json
{
  "shape": "persisted-after-write",
  "criterion": "SAVE-6",
  "accepted": {
    "SAVE-6/E1": { "property": "response.status", "op": "eq", "value": 201 },
    "SAVE-6/E2": { "property": "effect.count", "op": "count-eq", "value": 1 }
  },
  "design": {
    "obligation": "tob-000000000000",
    "skeleton": { "steps": [
      { "do": "call", "capability": "orbit.http.write", "input": { "endpointRef": "orders-api", "identityRef": "owner", "method": "POST", "path": "/orders", "body": { "orderKey": "ord-6006", "total": 42 } } },
      { "do": "call", "capability": "orbit.state.read", "input": { "stateRef": "orders-table", "request": { "key": "ord-6006" } } }
    ] },
    "assertions": [
      { "criterionRef": "SAVE-6/E1", "template": "value-eq", "step": 1 },
      { "criterionRef": "SAVE-6/E2", "template": "count-eq", "step": 2 }
    ],
    "controls": [
      { "role": "positive", "identityRef": "owner", "why": "the owner may place an order" },
      { "role": "state", "why": "exactly the one row the write made" }
    ],
    "trigger": { "kind": "interface", "ref": "orders-api", "step": 1 },
    "effectScope": "fixture"
  }
}
```

### idempotent-under-repeat

A duplicate control (the second request, sent on purpose with the same idempotency key) and a state control: one
persisted effect. Each request is ruled on by what it answered.

```json
{
  "shape": "idempotent-under-repeat",
  "criterion": "IDEM-7",
  "accepted": {
    "IDEM-7/E1": { "property": "effect.count", "op": "count-eq", "value": 1 },
    "IDEM-7/E2": { "property": "response.status", "op": "in", "value": [200, 201], "for": [] }
  },
  "design": {
    "obligation": "tob-000000000000",
    "skeleton": { "steps": [
      { "do": "call", "capability": "orbit.http.write", "input": { "endpointRef": "orders-api", "identityRef": "owner", "method": "POST", "path": "/payments", "headers": { "idempotency-key": "pay-7007" }, "body": { "paymentKey": "pay-7007", "amount": 42 } } },
      { "do": "call", "capability": "orbit.http.write", "input": { "endpointRef": "orders-api", "identityRef": "owner", "method": "POST", "path": "/payments", "headers": { "idempotency-key": "pay-7007" }, "body": { "paymentKey": "pay-7007", "amount": 42 } } },
      { "do": "call", "capability": "orbit.state.read", "input": { "stateRef": "payments-table", "request": { "key": "pay-7007" } } }
    ] },
    "assertions": [
      { "criterionRef": "IDEM-7/E2", "template": "value-in", "step": 1 },
      { "criterionRef": "IDEM-7/E2", "template": "value-in", "step": 2 },
      { "criterionRef": "IDEM-7/E1", "template": "count-eq", "step": 3 }
    ],
    "controls": [
      { "role": "duplicate", "why": "the same payment request, with the same idempotency key, sent twice on purpose" },
      { "role": "state", "why": "one payment however many times it was asked for" }
    ],
    "trigger": { "kind": "interface", "ref": "orders-api", "step": 1 },
    "effectScope": "fixture"
  }
}
```

## Asynchronous

### publication-routed

A positive control. An observer of the channel the contract routes to is armed BEFORE the trigger; the await asks it,
by the message's own id, within the slot's window.

```json
{
  "shape": "publication-routed",
  "criterion": "PUB-8",
  "accepted": {
    "PUB-8/E1": { "property": "message.id", "op": "complete-within", "value": "msg-8008", "within": 30 }
  },
  "design": {
    "obligation": "tob-000000000000",
    "skeleton": { "steps": [
      { "do": "call", "capability": "orbit.messaging.observe", "input": { "channelRef": "order-audit", "observerRef": "audit", "request": {} } },
      { "do": "call", "capability": "orbit.messaging.publish", "input": { "channelRef": "order-events", "request": { "messageId": "msg-8008", "correlationId": "ord-8008", "payload": { "orderKey": "ord-8008", "event": "placed" } } } },
      { "do": "call", "capability": "orbit.observe.await", "input": { "observerRef": "audit", "request": { "match": { "messageId": "msg-8008" }, "count": 1 } } }
    ] },
    "assertions": [{ "criterionRef": "PUB-8/E1", "template": "complete", "step": 3 }],
    "controls": [{ "role": "positive", "why": "an order event reaches the audit channel its contract routes it to" }],
    "trigger": { "kind": "message", "ref": "order-events", "step": 2 },
    "effectScope": "fixture"
  }
}
```

### effect-once-per-key

A duplicate control and a state control. A second message under the SAME business key is not a second effect: how it
settles is the system's own word. So each delivery is waited for by its own message id, ruled by a slot it satisfies
however it settles -- the first by being processed, the second by being delivered at all -- and the obligation is ruled
on its own slot, the effect count, read after both.

```json
{
  "shape": "effect-once-per-key",
  "criterion": "KEY-9",
  "accepted": {
    "KEY-9/E1": { "property": "effect.count", "op": "count-eq", "value": 1 },
    "KEY-9/E2": { "property": "settlement.outcome", "op": "complete-within", "value": "processed", "within": 60, "for": [] },
    "KEY-9/E3": { "property": "delivery.attempt", "op": "complete-within", "value": 1, "within": 60, "for": [] }
  },
  "design": {
    "obligation": "tob-000000000000",
    "skeleton": { "steps": [
      { "do": "call", "capability": "orbit.messaging.publish", "input": { "channelRef": "order-events", "request": { "messageId": "msg-9009a", "correlationId": "ord-9009", "payload": { "orderKey": "ord-9009", "businessKey": "ord-9009" } } } },
      { "do": "call", "capability": "orbit.messaging.publish", "input": { "channelRef": "order-events", "request": { "messageId": "msg-9009b", "correlationId": "ord-9009", "payload": { "orderKey": "ord-9009", "businessKey": "ord-9009" } } } },
      { "do": "call", "capability": "orbit.worker.observe", "input": { "workloadRef": "fulfilment", "request": { "match": { "messageId": "msg-9009a" }, "count": 1 } } },
      { "do": "call", "capability": "orbit.worker.observe", "input": { "workloadRef": "fulfilment", "request": { "match": { "messageId": "msg-9009b" }, "count": 1 } } },
      { "do": "call", "capability": "orbit.state.read", "input": { "stateRef": "orders-table", "request": { "key": "ord-9009" } } }
    ] },
    "assertions": [
      { "criterionRef": "KEY-9/E2", "template": "complete", "step": 3 },
      { "criterionRef": "KEY-9/E3", "template": "complete", "step": 4 },
      { "criterionRef": "KEY-9/E1", "template": "count-eq", "step": 5 }
    ],
    "controls": [
      { "role": "duplicate", "why": "a second message under the same business key, sent on purpose" },
      { "role": "state", "why": "one row for the key after both were delivered" }
    ],
    "trigger": { "kind": "message", "ref": "order-events", "step": 1 },
    "effectScope": "fixture"
  }
}
```

### crash-before-effect

A fault control and a state control. The fault is armed at a point the workload declares, its witness is the step that
sees the delivery end there (`step`, waiting within its own bound), the workload is brought back right after it, and
the redelivery's effect is awaited -- here on the channel the worker announces it on -- before the state is read.

```json
{
  "shape": "crash-before-effect",
  "criterion": "CRASH-10",
  "accepted": {
    "CRASH-10/E1": { "property": "effect.count", "op": "count-eq", "value": 1 },
    "CRASH-10/E2": { "property": "message.correlation.correlationId", "op": "complete-within", "value": "ord-1010", "within": 90, "for": [] }
  },
  "design": {
    "obligation": "tob-000000000000",
    "skeleton": { "steps": [
      { "do": "call", "capability": "orbit.messaging.observe", "input": { "channelRef": "order-status", "observerRef": "status", "request": {} } },
      { "do": "call", "capability": "orbit.workload.control", "input": { "workloadRef": "fulfilment", "request": { "action": "fault", "point": "before-effect" } } },
      { "do": "call", "capability": "orbit.messaging.publish", "input": { "channelRef": "order-events", "request": { "messageId": "msg-1010", "correlationId": "ord-1010", "payload": { "orderKey": "ord-1010" } } } },
      { "do": "call", "capability": "orbit.worker.observe", "input": { "workloadRef": "fulfilment", "request": { "match": { "messageId": "msg-1010" }, "count": 1, "waitMs": 30000 } } },
      { "do": "call", "capability": "orbit.workload.control", "input": { "workloadRef": "fulfilment", "request": { "action": "start" } } },
      { "do": "call", "capability": "orbit.observe.await", "input": { "observerRef": "status", "request": { "match": { "correlationId": "ord-1010" }, "count": 1 } } },
      { "do": "call", "capability": "orbit.state.read", "input": { "stateRef": "orders-table", "request": { "key": "ord-1010" } } }
    ] },
    "assertions": [
      { "criterionRef": "CRASH-10/E2", "template": "complete", "step": 6 },
      { "criterionRef": "CRASH-10/E1", "template": "count-eq", "step": 7 }
    ],
    "controls": [
      { "role": "fault", "point": "before-effect", "step": 4, "why": "the worker stops before its effect, at the point it declares" },
      { "role": "state", "why": "the effect still happens, once" }
    ],
    "trigger": { "kind": "message", "ref": "order-events", "step": 3 },
    "effectScope": "fixture"
  }
}
```

### crash-after-effect-before-ack

A fault control and a state control. The delivery that comes back after the effect committed is not a second effect, so
it is observed by its delivery attempt -- the second one came back -- never by a second success, and the obligation is
ruled on the effect count.

```json
{
  "shape": "crash-after-effect-before-ack",
  "criterion": "CRASH-11",
  "accepted": {
    "CRASH-11/E1": { "property": "effect.count", "op": "count-eq", "value": 1 },
    "CRASH-11/E2": { "property": "delivery.attempt", "op": "complete-within", "value": 2, "within": 90, "for": [] }
  },
  "design": {
    "obligation": "tob-000000000000",
    "skeleton": { "steps": [
      { "do": "call", "capability": "orbit.workload.control", "input": { "workloadRef": "fulfilment", "request": { "action": "fault", "point": "after-effect-before-ack" } } },
      { "do": "call", "capability": "orbit.messaging.publish", "input": { "channelRef": "order-events", "request": { "messageId": "msg-1111", "correlationId": "ord-1111", "payload": { "orderKey": "ord-1111" } } } },
      { "do": "call", "capability": "orbit.worker.observe", "input": { "workloadRef": "fulfilment", "request": { "match": { "messageId": "msg-1111" }, "count": 1, "waitMs": 30000 } } },
      { "do": "call", "capability": "orbit.workload.control", "input": { "workloadRef": "fulfilment", "request": { "action": "start" } } },
      { "do": "call", "capability": "orbit.worker.observe", "input": { "workloadRef": "fulfilment", "request": { "match": { "messageId": "msg-1111" }, "count": 2, "maxItems": 10 } } },
      { "do": "call", "capability": "orbit.state.read", "input": { "stateRef": "orders-table", "request": { "key": "ord-1111", "limit": 2 } } }
    ] },
    "assertions": [
      { "criterionRef": "CRASH-11/E2", "template": "complete", "step": 5 },
      { "criterionRef": "CRASH-11/E1", "template": "count-eq", "step": 6 }
    ],
    "controls": [
      { "role": "fault", "point": "after-effect-before-ack", "step": 3, "why": "the worker stops after its effect and before it acknowledged" },
      { "role": "state", "why": "the redelivery does not do it twice" }
    ],
    "trigger": { "kind": "message", "ref": "order-events", "step": 2 },
    "effectScope": "fixture"
  }
}
```

### competing-workers

A duplicate control and a state control. The same job delivered twice, so two workers may each receive it; the job is
observed by its own id until both deliveries were attempted, and the effect read after.

```json
{
  "shape": "competing-workers",
  "criterion": "JOB-12",
  "accepted": {
    "JOB-12/E1": { "property": "effect.count", "op": "count-eq", "value": 1 },
    "JOB-12/E2": { "property": "delivery.attempt", "op": "complete-within", "value": 1, "within": 60, "for": [] }
  },
  "design": {
    "obligation": "tob-000000000000",
    "skeleton": { "steps": [
      { "do": "call", "capability": "orbit.messaging.publish", "input": { "channelRef": "order-events", "request": { "messageId": "job-1212", "correlationId": "ord-1212", "payload": { "orderKey": "ord-1212" } } } },
      { "do": "call", "capability": "orbit.messaging.publish", "input": { "channelRef": "order-events", "request": { "messageId": "job-1212", "correlationId": "ord-1212", "payload": { "orderKey": "ord-1212" } } } },
      { "do": "call", "capability": "orbit.worker.observe", "input": { "workloadRef": "fulfilment", "request": { "match": { "messageId": "job-1212" }, "count": 2, "maxItems": 10 } } },
      { "do": "call", "capability": "orbit.state.read", "input": { "stateRef": "orders-table", "request": { "match": { "order_key": "ord-1212" }, "limit": 5 } } }
    ] },
    "assertions": [
      { "criterionRef": "JOB-12/E2", "template": "complete", "step": 3 },
      { "criterionRef": "JOB-12/E1", "template": "count-eq", "step": 4 }
    ],
    "controls": [
      { "role": "duplicate", "why": "the same job delivered twice on purpose, so a second worker may receive it" },
      { "role": "state", "why": "one effect for the job" }
    ],
    "trigger": { "kind": "message", "ref": "order-events", "step": 1 },
    "effectScope": "fixture"
  }
}
```

### lease-expiry-fencing

A fault control and a state control: the worker holds the job past its lease at a point it declares, the job comes back
to another, and no more effects are left than the contract allows.

```json
{
  "shape": "lease-expiry-fencing",
  "criterion": "LEASE-13",
  "accepted": {
    "LEASE-13/E1": { "property": "effect.count", "op": "count-at-most", "value": 1 },
    "LEASE-13/E2": { "property": "delivery.attempt", "op": "complete-within", "value": 2, "within": 120, "for": [] }
  },
  "design": {
    "obligation": "tob-000000000000",
    "skeleton": { "steps": [
      { "do": "call", "capability": "orbit.workload.control", "input": { "workloadRef": "fulfilment", "request": { "action": "fault", "point": "lease-held" } } },
      { "do": "call", "capability": "orbit.messaging.publish", "input": { "channelRef": "order-events", "request": { "messageId": "msg-1313", "correlationId": "ord-1313", "payload": { "orderKey": "ord-1313" } } } },
      { "do": "call", "capability": "orbit.worker.observe", "input": { "workloadRef": "fulfilment", "request": { "match": { "messageId": "msg-1313" }, "count": 1, "waitMs": 60000 } } },
      { "do": "call", "capability": "orbit.workload.control", "input": { "workloadRef": "fulfilment", "request": { "action": "restart" } } },
      { "do": "call", "capability": "orbit.worker.observe", "input": { "workloadRef": "fulfilment", "request": { "match": { "messageId": "msg-1313" }, "count": 2 } } },
      { "do": "call", "capability": "orbit.state.read", "input": { "stateRef": "orders-table", "request": { "key": "ord-1313", "limit": 3 } } }
    ] },
    "assertions": [
      { "criterionRef": "LEASE-13/E2", "template": "complete", "step": 5 },
      { "criterionRef": "LEASE-13/E1", "template": "count-at-most", "step": 6 }
    ],
    "controls": [
      { "role": "fault", "point": "lease-held", "step": 3, "why": "the worker holds the job past its lease" },
      { "role": "state", "why": "the late worker leaves no second effect" }
    ],
    "trigger": { "kind": "message", "ref": "order-events", "step": 2 },
    "effectScope": "fixture"
  }
}
```

### terminal-after-retries

A fault control: the message cannot succeed, is retried as the policy says, and ends where it says. The dead-letter
channel's observer is armed before the trigger; the attempts and the dead letter are counted after the workload is back.

```json
{
  "shape": "terminal-after-retries",
  "criterion": "DLQ-14",
  "accepted": {
    "DLQ-14/E1": { "property": "message.id", "op": "count-eq", "value": 1 },
    "DLQ-14/E2": { "property": "delivery.attempt", "op": "count-eq", "value": 3 }
  },
  "design": {
    "obligation": "tob-000000000000",
    "skeleton": { "steps": [
      { "do": "call", "capability": "orbit.messaging.observe", "input": { "channelRef": "order-events-dlq", "observerRef": "dead", "request": {} } },
      { "do": "call", "capability": "orbit.workload.control", "input": { "workloadRef": "fulfilment", "request": { "action": "fault", "point": "reject-always" } } },
      { "do": "call", "capability": "orbit.messaging.publish", "input": { "channelRef": "order-events", "request": { "messageId": "msg-1414", "correlationId": "ord-1414", "payload": { "orderKey": "ord-1414" } } } },
      { "do": "call", "capability": "orbit.worker.observe", "input": { "workloadRef": "fulfilment", "request": { "match": { "messageId": "msg-1414" }, "count": 3, "waitMs": 90000 } } },
      { "do": "call", "capability": "orbit.workload.control", "input": { "workloadRef": "fulfilment", "request": { "action": "start" } } },
      { "do": "call", "capability": "orbit.worker.observe", "input": { "workloadRef": "fulfilment", "request": { "match": { "messageId": "msg-1414" } } } },
      { "do": "call", "capability": "orbit.observe.await", "input": { "observerRef": "dead", "request": { "match": { "messageId": "msg-1414" }, "count": 1 } } }
    ] },
    "assertions": [
      { "criterionRef": "DLQ-14/E2", "template": "count-eq", "step": 6 },
      { "criterionRef": "DLQ-14/E1", "template": "count-eq", "step": 7 }
    ],
    "controls": [{ "role": "fault", "point": "reject-always", "step": 4, "why": "every attempt of this message fails, at the point the worker declares" }],
    "trigger": { "kind": "message", "ref": "order-events", "step": 3 },
    "effectScope": "fixture"
  }
}
```

### ordered-transitions

A positive control: the commands go in the order the contract allows, and the transitions they cause are observed in
that order, on one key, by its correlation.

```json
{
  "shape": "ordered-transitions",
  "criterion": "SEQ-15",
  "accepted": {
    "SEQ-15/E1": { "property": "message.payload.status", "op": "ordered", "value": ["placed", "paid", "shipped"] }
  },
  "design": {
    "obligation": "tob-000000000000",
    "skeleton": { "steps": [
      { "do": "call", "capability": "orbit.messaging.observe", "input": { "channelRef": "order-status", "observerRef": "transitions", "request": {} } },
      { "do": "call", "capability": "orbit.messaging.publish", "input": { "channelRef": "order-events", "request": { "messageId": "msg-1515a", "correlationId": "ord-1515", "payload": { "orderKey": "ord-1515", "command": "place" } } } },
      { "do": "call", "capability": "orbit.messaging.publish", "input": { "channelRef": "order-events", "request": { "messageId": "msg-1515b", "correlationId": "ord-1515", "payload": { "orderKey": "ord-1515", "command": "pay" } } } },
      { "do": "call", "capability": "orbit.messaging.publish", "input": { "channelRef": "order-events", "request": { "messageId": "msg-1515c", "correlationId": "ord-1515", "payload": { "orderKey": "ord-1515", "command": "ship" } } } },
      { "do": "call", "capability": "orbit.observe.await", "input": { "observerRef": "transitions", "request": { "match": { "correlationId": "ord-1515" }, "count": 3 } } }
    ] },
    "assertions": [{ "criterionRef": "SEQ-15/E1", "template": "order-eq", "step": 5 }],
    "controls": [{ "role": "positive", "why": "commands in an allowed order move the order through its states in that order" }],
    "trigger": { "kind": "message", "ref": "order-events", "step": 2 },
    "effectScope": "fixture"
  }
}
```

### completes-by-deadline

A positive control: what the trigger starts is done within the accepted deadline, seen on an observation that stayed
complete -- the window is the slot's own `within`.

```json
{
  "shape": "completes-by-deadline",
  "criterion": "SLA-16",
  "accepted": {
    "SLA-16/E1": { "property": "message.correlation.correlationId", "op": "complete-within", "value": "ord-1616", "within": 120 },
    "SLA-16/E2": { "property": "response.status", "op": "eq", "value": 202, "for": [] }
  },
  "design": {
    "obligation": "tob-000000000000",
    "skeleton": { "steps": [
      { "do": "call", "capability": "orbit.messaging.observe", "input": { "channelRef": "order-confirmed", "observerRef": "confirmed", "request": {} } },
      { "do": "call", "capability": "orbit.http.write", "input": { "endpointRef": "orders-api", "identityRef": "owner", "method": "POST", "path": "/orders", "body": { "orderKey": "ord-1616", "total": 16 } } },
      { "do": "call", "capability": "orbit.observe.await", "input": { "observerRef": "confirmed", "request": { "match": { "correlationId": "ord-1616" }, "count": 1 } } }
    ] },
    "assertions": [
      { "criterionRef": "SLA-16/E2", "template": "value-eq", "step": 2 },
      { "criterionRef": "SLA-16/E1", "template": "complete", "step": 3 }
    ],
    "controls": [{ "role": "positive", "identityRef": "owner", "why": "an order the owner places is confirmed within the deadline" }],
    "trigger": { "kind": "interface", "ref": "orders-api", "step": 2 },
    "effectScope": "fixture"
  }
}
```

### outbox-atomic

A fault control and a state control: the relay stops after it published and before it marked the message sent; once it
is back, the message is out and the business write is there, once.

```json
{
  "shape": "outbox-atomic",
  "criterion": "OUT-17",
  "accepted": {
    "OUT-17/E1": { "property": "effect.count", "op": "count-eq", "value": 1 },
    "OUT-17/E2": { "property": "message.correlation.correlationId", "op": "complete-within", "value": "ord-1717", "within": 120, "for": [] },
    "OUT-17/E3": { "property": "response.status", "op": "eq", "value": 201, "for": [] }
  },
  "design": {
    "obligation": "tob-000000000000",
    "skeleton": { "steps": [
      { "do": "call", "capability": "orbit.messaging.observe", "input": { "channelRef": "order-events", "observerRef": "outgoing", "request": {} } },
      { "do": "call", "capability": "orbit.workload.control", "input": { "workloadRef": "outbox-relay", "request": { "action": "fault", "point": "after-publish-before-mark" } } },
      { "do": "call", "capability": "orbit.http.write", "input": { "endpointRef": "orders-api", "identityRef": "owner", "method": "POST", "path": "/orders", "body": { "orderKey": "ord-1717", "total": 17 } } },
      { "do": "call", "capability": "orbit.worker.observe", "input": { "workloadRef": "outbox-relay", "request": { "match": { "outcome": "fault" }, "count": 1, "waitMs": 60000 } } },
      { "do": "call", "capability": "orbit.workload.control", "input": { "workloadRef": "outbox-relay", "request": { "action": "start" } } },
      { "do": "call", "capability": "orbit.observe.await", "input": { "observerRef": "outgoing", "request": { "match": { "correlationId": "ord-1717" }, "count": 1 } } },
      { "do": "call", "capability": "orbit.state.read", "input": { "stateRef": "orders-table", "request": { "key": "ord-1717" } } }
    ] },
    "assertions": [
      { "criterionRef": "OUT-17/E3", "template": "value-eq", "step": 3 },
      { "criterionRef": "OUT-17/E2", "template": "complete", "step": 6 },
      { "criterionRef": "OUT-17/E1", "template": "count-eq", "step": 7 }
    ],
    "controls": [
      { "role": "fault", "point": "after-publish-before-mark", "step": 4, "why": "the relay stops between publishing and marking the message sent" },
      { "role": "state", "why": "the business write stays, once" }
    ],
    "trigger": { "kind": "interface", "ref": "orders-api", "step": 3 },
    "effectScope": "fixture"
  }
}
```

## Schedules

### occurrence-one-execution

A positive control: one due occurrence, dispatched by its own id, decided once and executed once.

```json
{
  "shape": "occurrence-one-execution",
  "criterion": "SCHED-18",
  "accepted": {
    "SCHED-18/E1": { "property": "effect.count", "op": "count-eq", "value": 1 },
    "SCHED-18/E2": { "property": "occurrence.decision", "op": "complete-within", "value": "due", "within": 60, "for": [] }
  },
  "design": {
    "obligation": "tob-000000000000",
    "skeleton": { "steps": [
      { "do": "call", "capability": "orbit.scheduler.trigger", "input": { "scheduleRef": "nightly-settle", "request": { "occurrenceId": "nightly-settle:2027-02-01T02:00:00Z" } } },
      { "do": "call", "capability": "orbit.scheduler.observe", "input": { "scheduleRef": "nightly-settle", "request": { "match": { "occurrenceId": "nightly-settle:2027-02-01T02:00:00Z" }, "count": 1 } } },
      { "do": "call", "capability": "orbit.state.read", "input": { "stateRef": "settlements-table", "request": { "key": "nightly-settle:2027-02-01T02:00:00Z" } } }
    ] },
    "assertions": [
      { "criterionRef": "SCHED-18/E2", "template": "complete", "step": 2 },
      { "criterionRef": "SCHED-18/E1", "template": "count-eq", "step": 3 }
    ],
    "controls": [{ "role": "positive", "why": "the due night settles once" }],
    "trigger": { "kind": "schedule", "ref": "nightly-settle", "step": 1 },
    "effectScope": "fixture"
  }
}
```

### not-before-due

A negative control -- and a positive one, since an absence alone proves nothing: a minute before the occurrence is due
nothing of it runs, and at its due time it does. The clock is moved through an adapter that can inject one.

```json
{
  "shape": "not-before-due",
  "criterion": "DUE-19",
  "accepted": {
    "DUE-19/E1": { "property": "occurrence.id", "op": "absent-within", "value": "nightly-settle:2027-02-02T02:00:00Z", "within": 30 },
    "DUE-19/E2": { "property": "occurrence.decision", "op": "complete-within", "value": "due", "within": 60, "for": [] }
  },
  "design": {
    "obligation": "tob-000000000000",
    "skeleton": { "steps": [
      { "do": "call", "capability": "orbit.clock.advance", "input": { "clockRef": "shop", "request": { "to": "2027-02-02T01:59:00Z" } } },
      { "do": "call", "capability": "orbit.scheduler.observe", "input": { "scheduleRef": "nightly-settle", "request": { "match": { "occurrenceId": "nightly-settle:2027-02-02T02:00:00Z" } } } },
      { "do": "call", "capability": "orbit.clock.advance", "input": { "clockRef": "shop", "request": { "to": "2027-02-02T02:00:00Z" } } },
      { "do": "call", "capability": "orbit.scheduler.observe", "input": { "scheduleRef": "nightly-settle", "request": { "match": { "occurrenceId": "nightly-settle:2027-02-02T02:00:00Z" }, "count": 1 } } }
    ] },
    "assertions": [
      { "criterionRef": "DUE-19/E1", "template": "absent-within", "step": 2 },
      { "criterionRef": "DUE-19/E2", "template": "complete", "step": 4 }
    ],
    "controls": [
      { "role": "negative", "why": "a minute before it is due, nothing of the occurrence runs" },
      { "role": "positive", "why": "at its due time it does, so the absence is not a scheduler that never runs" }
    ],
    "trigger": { "kind": "schedule", "ref": "nightly-settle", "step": 3 },
    "effectScope": "fixture"
  }
}
```

### missed-occurrence-policy

A fault control: the scheduler misses its tick at a point it declares while the clock passes the due time; once it is
back, the occurrence is handled as the policy says.

```json
{
  "shape": "missed-occurrence-policy",
  "criterion": "MISS-20",
  "accepted": {
    "MISS-20/E1": { "property": "effect.count", "op": "count-eq", "value": 1 },
    "MISS-20/E2": { "property": "occurrence.decision", "op": "complete-within", "value": "caught-up", "within": 120, "for": [] }
  },
  "design": {
    "obligation": "tob-000000000000",
    "skeleton": { "steps": [
      { "do": "call", "capability": "orbit.workload.control", "input": { "workloadRef": "settlement-scheduler", "request": { "action": "fault", "point": "miss-tick" } } },
      { "do": "call", "capability": "orbit.clock.advance", "input": { "clockRef": "shop", "request": { "to": "2027-02-03T02:05:00Z" } } },
      { "do": "call", "capability": "orbit.worker.observe", "input": { "workloadRef": "settlement-scheduler", "request": { "match": { "outcome": "fault" }, "count": 1, "waitMs": 30000 } } },
      { "do": "call", "capability": "orbit.workload.control", "input": { "workloadRef": "settlement-scheduler", "request": { "action": "start" } } },
      { "do": "call", "capability": "orbit.scheduler.observe", "input": { "scheduleRef": "nightly-settle", "request": { "match": { "occurrenceId": "nightly-settle:2027-02-03T02:00:00Z" }, "count": 1 } } },
      { "do": "call", "capability": "orbit.state.read", "input": { "stateRef": "settlements-table", "request": { "key": "nightly-settle:2027-02-03T02:00:00Z" } } }
    ] },
    "assertions": [
      { "criterionRef": "MISS-20/E2", "template": "complete", "step": 5 },
      { "criterionRef": "MISS-20/E1", "template": "count-eq", "step": 6 }
    ],
    "controls": [{ "role": "fault", "point": "miss-tick", "step": 3, "why": "the scheduler misses the tick the occurrence was due at" }],
    "trigger": { "kind": "schedule", "ref": "nightly-settle", "step": 2 },
    "effectScope": "fixture"
  }
}
```

### overlap-policy

A duplicate control: the same occurrence is dispatched again while the first still runs, on purpose; the policy says how
many executions it may leave.

```json
{
  "shape": "overlap-policy",
  "criterion": "OVL-21",
  "accepted": {
    "OVL-21/E1": { "property": "effect.count", "op": "count-at-most", "value": 1 },
    "OVL-21/E2": { "property": "occurrence.decision", "op": "complete-within", "value": "due", "within": 60, "for": [] }
  },
  "design": {
    "obligation": "tob-000000000000",
    "skeleton": { "steps": [
      { "do": "call", "capability": "orbit.scheduler.trigger", "input": { "scheduleRef": "nightly-settle", "request": { "occurrenceId": "nightly-settle:2027-02-04T02:00:00Z" } } },
      { "do": "call", "capability": "orbit.scheduler.trigger", "input": { "scheduleRef": "nightly-settle", "request": { "occurrenceId": "nightly-settle:2027-02-04T02:00:00Z" } } },
      { "do": "call", "capability": "orbit.scheduler.observe", "input": { "scheduleRef": "nightly-settle", "request": { "match": { "occurrenceId": "nightly-settle:2027-02-04T02:00:00Z" }, "count": 2 } } },
      { "do": "call", "capability": "orbit.state.read", "input": { "stateRef": "settlements-table", "request": { "key": "nightly-settle:2027-02-04T02:00:00Z" } } }
    ] },
    "assertions": [
      { "criterionRef": "OVL-21/E2", "template": "complete", "step": 3 },
      { "criterionRef": "OVL-21/E1", "template": "count-at-most", "step": 4 }
    ],
    "controls": [{ "role": "duplicate", "why": "the occurrence dispatched again while the first one still runs" }],
    "trigger": { "kind": "schedule", "ref": "nightly-settle", "step": 1 },
    "effectScope": "fixture"
  }
}
```

### zone-and-calendar

A positive control: an occurrence the zone's daylight-saving change moves is dispatched by its id, and its own answer
says when it was scheduled for.

```json
{
  "shape": "zone-and-calendar",
  "criterion": "ZONE-22",
  "accepted": {
    "ZONE-22/E1": { "property": "occurrence.scheduledFor", "op": "eq", "value": "2027-03-28T00:30:00Z" }
  },
  "design": {
    "obligation": "tob-000000000000",
    "skeleton": { "steps": [
      { "do": "call", "capability": "orbit.scheduler.trigger", "input": { "scheduleRef": "nightly-settle", "request": { "occurrenceId": "nightly-settle:2027-03-28" } } }
    ] },
    "assertions": [{ "criterionRef": "ZONE-22/E1", "template": "value-eq", "step": 1 }],
    "controls": [{ "role": "positive", "why": "the night the clocks move still settles at the instant the zone puts it" }],
    "trigger": { "kind": "schedule", "ref": "nightly-settle", "step": 1 },
    "effectScope": "fixture"
  }
}
```

## Screens

### screen-shows-result

A positive control on a design that drives a PAGE (`page`: the screen's interface and who the browser acts as). Steps
say what to wait for and read -- never a script: the engine writes those. The call the page makes is witnessed by its
status, the state below is read, and the screen's text is read last.

```json
{
  "shape": "screen-shows-result",
  "criterion": "UI-2",
  "accepted": {
    "UI-2/E1": { "property": "ui.text", "op": "contains", "value": "ord-2002" },
    "UI-2/E2": { "property": "response.status", "op": "eq", "value": 200 },
    "UI-2/E3": { "property": "effect.count", "op": "count-eq", "value": 1 }
  },
  "design": {
    "obligation": "tob-000000000000",
    "skeleton": { "steps": [
      { "do": "goto", "url": "/orders/ord-2002", "until": { "selector": "[data-testid=order-detail]", "attribute": "aria-busy", "equals": "false" } },
      { "do": "api", "match": "/api/orders/ord-2002", "method": "GET" },
      { "do": "call", "capability": "orbit.state.read", "input": { "stateRef": "orders-table", "request": { "key": "ord-2002" } } },
      { "do": "report", "reads": { "selector": "[data-testid=order-title]" } }
    ] },
    "assertions": [
      { "criterionRef": "UI-2/E2", "template": "value-eq", "step": 2 },
      { "criterionRef": "UI-2/E3", "template": "count-eq", "step": 3 },
      { "criterionRef": "UI-2/E1", "template": "value-includes", "step": 4 }
    ],
    "controls": [{ "role": "positive", "why": "the owner sees the order the store holds" }],
    "page": { "endpointRef": "orders-ui", "identityRef": "owner" },
    "effectScope": "fixture"
  }
}
```
