# ORBIT-GOV-005 — a secret is masked by its shape wherever it sits, and a run record keeps its structure

`src/scrub.mjs` is where Orbit masks what must never outlive a run: the run ledger's door (`scrubRecord`, through
`recordRun`), a lesson's and a note's, and what every report renders. It masks by SHAPE, never by a product's name --
what a secret LOOKS like needs no product knowledge to be right -- and the fields of a run record it masks are declared
once, in `FREE_TEXT`.

The behaviour this source must have:

- `scrub(text)` masks every secret-shaped value in a text, whatever surrounds it:
  - a JSON web token (`eyJ…`);
  - `Basic` credentials, the encoded value with them;
  - a value named by a secret word -- `password`, `pwd`, `secret`, `token`, `api key` (`api_key`, `apiKey`, `api-key`),
    `pat`, `credential`, `authorization`, `bearer` -- after `:` or `=`, quoted (with its spaces) or not;
  - a `Bearer` token;
  - an environment assignment of a secret-named variable (`REPO_PAT=…`, `DB_PASSWORD=…`, `SERVICE_API_KEY = …`);
  - a connection string's server, user and password (`Server=`, `Data Source=`, `User ID=`, `Uid=`, `Pwd=`,
    `Password=`);
  - an address shaped like a user principal name (`someone@example.org`);
  - a run of 32 or more hexadecimal characters, in either case -- an opaque key or token, however long.
- Text that is not secret-shaped is left as written: words, screen and case ids, `path=…` and `patch=…`, the word
  "password" when no value follows it, a number, and a hexadecimal run shorter than 32 characters, such as a 7–12
  character commit id or a 16 character fingerprint.
- `scrubbed(value)` reaches every string at any depth, in objects and lists alike, and a value under a secret-named key
  (`PASSWORD`, `Api_Key`, `client_secret`, `apiKey`, `x-api-key`, `access_token`, `REPO_PAT`, `credentials`, …) is
  redacted whatever it is -- a string, a list or an object. A value under a plain key is left as written unless it is
  itself secret-shaped. `SECRET_NAME` says whether a key is such a name, case-insensitively, and `path`, `patch`,
  `NAME`, `fe_commit` or a word that merely contains a secret word (`compatible`, `tokenizer`) is not.
- `scrubRecord(record)` masks exactly the free-text fields of a run record -- what a command line gave (`params`), what
  SQL returned (`resolved`), what a step read off the page (`captured`), the `report`, who was signed in (`identity`)
  and why it stopped (`failure`), the list `FREE_TEXT` declares -- and leaves every other field exactly as it was:
  `fe_commit` is a commit id however long, and masking it would leave coverage unable to tell a current PASS from a
  stale one; the case, the status and what was proved are how a run is read back.

Make the smallest change in `src/scrub.mjs` that gives this behaviour, and add a regression test under `test/` that
fails before your change and passes after it. Do not change or delete an existing test.
