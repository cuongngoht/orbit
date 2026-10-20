# Autonomous QA settings — what a person approves

One document per project, in the machine store (`<store>/autonomous-qa/settings.json`), written by
a person in **Orbit Control → Autonomous QA**, or relayed by a session with
`node <engine>/cli/autonomous-qa.mjs settings set <path>=<json> --human`. Every write names the
revision it read; a stale one is refused. `settings` with no argument prints the document and its
revision. An unknown key, or anything shaped like a credential, is refused.

| key | default | what it approves |
|---|---|---|
| `enabled` | `false` | whether autonomous QA may act in a browser at all |
| `environments` | `[]` | `[{ id, origin, kind, modes }]` — where it may act, and in which modes. `kind` is `test · staging · development · production`; `observe` needs only the environment, every other mode must be listed. No approval buys `explore-write` or `security-test` on `production` |
| `identities` | `[]` | the identity names (`as`) it may drive; each is a signed-in profile mapped as for run-case |
| `limits` | `{ actions: 25, requestsPerAction: 40, minutes: 20, pollSeconds: 30, decisions: 50, noProgress: 4 }` | the budget of one investigation: actions and decisions are cumulative (a resume never resets them), minutes run from the start or the latest resume, and `noProgress` is how many steps may learn nothing before the loop stops |
| `network` | `{ details: true, fingerprints: true, correlationHeaders: [], idempotencyHeaders: ["idempotency-key"], ignoreFields: [] }` | whether each request's detail is read, whether write bodies may be FINGERPRINTED (never kept), which headers carry correlation or idempotency keys, which body fields are volatile |
| `duplicates` | all `[]` | the accepted duplicate policy: `polling`, `retries` (`attempts`), `idempotent`, `intentional` (`count`), `contracts` (`maxPerAction`). Each row is `{ match: "<regex over the path>", method? }` |
| `consistency` | `{}` | a `graph/meta.json` timing name → the seconds its data may take |
| `tenancy` | `null` | the authorisation contract a tenant check is held to (below) |
| `reports` | `{ internal: false }` | whether an UNREDACTED report may be written at all |
| `memory` | `{ project: true }` | whether a checkpoint projects what an investigation VERIFIED into the project's knowledge — only results against an accepted oracle, citing the receipt they rest on; receipts stay in the journal either way |

## A typical first approval

```bash
node cli/autonomous-qa.mjs settings set enabled=true --human
node cli/autonomous-qa.mjs settings set environments='[{"id":"test","origin":"https://app.test.example","kind":"test","modes":["observe","explore-write"]}]' --human
node cli/autonomous-qa.mjs settings set identities='["admin"]' --human
```

## A duplicate policy

"Saving sends exactly one POST" is a requirement only once somebody accepted it:

```json
{ "duplicates": {
    "contracts": [{ "match": "^/api/workspaces$", "method": "POST", "maxPerAction": 1 }],
    "retries":   [{ "match": "^/api/", "method": "POST", "attempts": 3 }],
    "polling":   [{ "match": "^/api/notifications" }] } }
```

## A tenancy contract

```json
{ "tenancy": {
    "claim": "tid",
    "tenants": { "A": "<tenant A's claim value>", "B": "<tenant B's claim value>" },
    "identities": { "tenantA": ["A"], "tenantB": ["B"], "partner": ["A", "B"] },
    "resources": {
      "a-workspace": { "tenant": "A", "marker": "Orbit-TENANT-A-7F3K",
                       "route": "/workspaces/1001", "api": "/api/workspaces/1001",
                       "search": "/api/workspaces?q=Orbit-TENANT-A",
                       "data": { "query": "SELECT Name, UpdatedAt FROM Workspaces WHERE Id = 1001", "table": "Workspaces" },
                       "write": { "method": "PUT", "api": "/api/workspaces/1001", "body": { "name": "TC-probe" } } } },
    "matrix": [
      { "identity": "tenantA", "resource": "a-workspace", "operation": "read", "expect": "allowed" },
      { "identity": "tenantB", "resource": "a-workspace", "operation": "read", "expect": "denied", "status": [403, 404] },
      { "identity": "tenantB", "resource": "a-workspace", "operation": "search", "expect": "excluded" },
      { "identity": "tenantB", "resource": "a-workspace", "operation": "update", "expect": "denied", "status": [403, 404] },
      { "identity": "tenantA", "resource": "a-workspace", "operation": "unchanged", "expect": "unchanged" }
    ],
    "writeProbes": true } }
```

- A resource is an approved **synthetic** record; `marker` is a text only it carries, so "tenant B
  saw it" is a yes/no and no data is ever copied.
- `identities` lists every tenant an identity may legitimately act in, so a user who belongs to
  both is not mistaken for a leak. A row expecting `denied` for an identity that belongs to the
  resource's tenant is reported as a contradiction in the contract, not run.
- `status` is what the contract accepts as a denial; 403 and 404 are both common. With none
  declared, an empty 2xx asks for a requirement instead of being judged.
- `update` rows attempt a write, so they need `writeProbes: true` and an approved `security-test`
  mode, and they need `data`: whether the write landed is read from the database, not from the
  status.
- The API probe asks from inside the identity's OWN signed-in page. No credential is read or
  replayed. If the application authenticates its API in a way that probe cannot use, the allowed
  row fails first and every denial reads INCONCLUSIVE. That is the right answer, and a project
  capability (orbit-qc-builder) is the way past it.
