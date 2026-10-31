// THE SPEC of ORBIT-GOV-005: a secret is masked by its SHAPE wherever it sits, and a run record keeps its structure.
// Every check hands the subject a text, a value or a run record with secrets PLANTED in it and plain words or
// structural fields it must KEEP, and expects nothing back: the probe names every planted secret that survived
// (`leak:<kind>`) and every kept thing that changed (`damaged:<name>`). Written from the contract (AGENTS.md "Security":
// masked by shape and never by name, what is masked declared once in FREE_TEXT, structural fields deliberately left
// alone; the header and the comments of src/scrub.mjs), kept beside the probe and handed to no runner; it never imports
// the subject. Both directions are checked: a scrubber that masks nothing leaks, and one that masks everything damages.
//
// The reference model is the contract's shapes: selfTest holds it to a table written by hand, then holds every input
// to it -- every text a secret is planted in is secret-shaped, and every plain word it must keep is not -- so a check
// can never demand that a plain word be masked or a secret be kept.
//
//   GROUPS -> { group: sentence }        cases(seed, samples) -> [{ id, group, input, expect }]
//   selfTest() -> [finding]              the reference model held to the contract, and every input held to the model
export const CASE = "ORBIT-GOV-005";

export const GROUPS = {
  "token-masked": "a JSON web token is masked wherever it sits in a text",
  "basic-masked": "Basic credentials are masked, the encoded value with them",
  "named-masked": "a value a secret word names -- password, pwd, secret, token, api key, pat, credential, authorization -- after : or =, quoted or not, is masked",
  "bearer-masked": "a Bearer token is masked",
  "assignment-masked": "an environment assignment of a secret-named variable is masked",
  "connection-masked": "a connection string's server, user and password are masked",
  "upn-masked": "an address shaped like a user principal name is masked",
  "hex-masked": "a run of 32 or more hexadecimal characters -- an opaque key or token -- is masked, however long and in either case",
  "plain-text-kept": "text that is not secret-shaped -- words, ids, path= and patch=, the word password with no value, a hex run shorter than 32 -- is left as written",
  "secret-named-key": "scrubbed redacts whatever sits under a secret-named key, at any depth, and reaches every string beside it",
  "plain-named-key": "scrubbed leaves a value under a plain key as written unless it is itself secret-shaped",
  "secret-name": "SECRET_NAME knows a secret-named key however it is spelled, and never path, patch, NAME, fe_commit or a word that merely contains a secret word",
  "record-free-text": "scrubRecord masks every secret in the free-text fields of a run record: params, resolved, captured, report, identity and failure",
  "record-structure": "scrubRecord leaves every other field of a run record exactly as it was: fe_commit however long, the case, the status, what was proved",
  "free-text-declared": "FREE_TEXT declares the free-text fields of a run record once: params, resolved, captured, report, identity and failure",
  "seeded-text": "secrets of every shape at random among plain words: every secret masked, every plain word kept",
  "seeded-record": "run records at random: every free-text secret masked, every structural field kept",
};

// ---- the reference model: what a secret LOOKS like, as the contract names the shapes -------------------------------

const SECRET_WORDS = "bearer|authorization|api[-_ ]?key|password|pwd|secret|token|pat|credentials?";

const SHAPES = [
  ["token", /eyJ[\w-]{8,}\.[\w-]+\.[\w-]*/],
  ["basic", /\bbasic\s+[A-Za-z0-9+/]{8,}/i],
  ["named", new RegExp(`\\b(${SECRET_WORDS})\\b["']?\\s*[:=]`, "i")],
  ["bearer", /\bbearer\s+[^\s,;"'}]/i],
  ["assignment", /\b[A-Z][A-Z0-9_]*(PAT|TOKEN|SECRET|PASSWORD|PWD|API_?KEY|CREDENTIALS?)\s*=/],
  ["connection", /\b(server|data source|user id|uid|pwd|password)=/i],
  ["upn", /[\w.+-]+@[\w-]+\.[\w.]{2,}/],
  ["hex", /\b[0-9A-Fa-f]{32,}\b/],
];

export const shapeOf = (text) => SHAPES.find(([, re]) => re.test(String(text)))?.[0] ?? null;

// A key is a secret's name when a secret word stands in it on its own: bounded by anything but a letter or a digit.
export const secretName = (key) => new RegExp(`(^|[^a-z0-9])(${SECRET_WORDS})($|[^a-z0-9])`, "i").test(String(key));

export const FREE = ["params", "resolved", "captured", "report", "identity", "failure"];

// ---- what the inputs are made of ----------------------------------------------------------------------------------

const NOTHING = { exactly: [] };

// A run of hexadecimal characters of exactly n, the same every time and never a piece of another: no planted key may
// sit inside a structural field the check keeps.
const hexRun = (n, from = 0) => ((r) => Array.from({ length: n }, () => "0123456789abcdef"[Math.floor(r() * 16)]).join(""))(mulberry32(from * 7919 + n));

const planted = (pairs) => pairs.map(([kind, value]) => ({ kind, value }));

const keptPaths = (pairs) => pairs.map(([name, path]) => ({ name, path }));

const AROUND = [["case", "case create-thing"], ["screen", "on screen orders-list"]];

const masked = (group, secret, values, kind) => ({ group, input: { call: "scrub", text: `case create-thing | ${secret} | on screen orders-list`, planted: values.map((value) => ({ kind, value })), kept: AROUND.map(([name, value]) => ({ name, value })) }, expect: NOTHING });

const kept = (group, fragments) => ({ group, input: { call: "scrub", text: fragments.map(([, value]) => value).join(" | "), planted: [], kept: fragments.map(([name, value]) => ({ name, value })) }, expect: NOTHING });

const JWT = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0LXVzZXIifQ.c2lnbmF0dXJlLXZhbHVl";
const UNSIGNED = "eyJraWQiOiJrZXktMSJ9.eyJhdWQiOiJvcmJpdC10ZXN0In0.";

const TEXT_ROWS = [
  masked("token-masked", `signed in with ${JWT} today`, [JWT], "token"),
  masked("token-masked", `{"id_token":"${UNSIGNED}"}`, [UNSIGNED], "token"),
  masked("basic-masked", "sent Basic dXNlcjpzM2NyM3QtcGFzcw== upstream", ["dXNlcjpzM2NyM3QtcGFzcw"], "basic"),
  masked("basic-masked", "Authorization: Basic YWRtaW46aHVudGVyLTI=", ["YWRtaW46aHVudGVyLTI"], "basic"),
  masked("named-masked", "password=hunter2-correct-horse", ["hunter2-correct-horse"], "named"),
  masked("named-masked", '{"password":"opaque-credential-77"}', ["opaque-credential-77"], "named"),
  masked("named-masked", "api_key: k3y-9f2a-77x", ["k3y-9f2a-77x"], "named"),
  masked("named-masked", "apiKey=AbC123xyz987q", ["AbC123xyz987q"], "named"),
  masked("named-masked", "api key = sp4ced-k3y-1", ["sp4ced-k3y-1"], "named"),
  masked("named-masked", "token: t0k-abc-123-xyz", ["t0k-abc-123-xyz"], "named"),
  masked("named-masked", "pwd=Sh0rt-Pw-x1", ["Sh0rt-Pw-x1"], "named"),
  masked("named-masked", "secret='opaque-one opaque-two'", ["opaque-one", "opaque-two"], "named"),
  masked("named-masked", "pat=pt-0a1b2c3d4e", ["pt-0a1b2c3d4e"], "named"),
  masked("named-masked", "credential: cr3d-x9y8z7", ["cr3d-x9y8z7"], "named"),
  masked("named-masked", "authorization: sig-v4-abcdef1", ["sig-v4-abcdef1"], "named"),
  masked("bearer-masked", "retried with Bearer opaque-credential-42 after a 401", ["opaque-credential-42"], "bearer"),
  masked("bearer-masked", "header bearer AbCdEf.123-xyz_9 sent", ["AbCdEf.123-xyz_9"], "bearer"),
  masked("assignment-masked", "REPO_PAT=rp-AbCdEf123456 node start", ["rp-AbCdEf123456"], "assignment"),
  masked("assignment-masked", "DB_PASSWORD=Pa55-w0rd-xyz npm test", ["Pa55-w0rd-xyz"], "assignment"),
  masked("assignment-masked", "SERVICE_API_KEY = svc-key-0a1b2c3d4e", ["svc-key-0a1b2c3d4e"], "assignment"),
  masked("assignment-masked", "CLOUD_CREDENTIALS=cc-9z8y7x6w5v", ["cc-9z8y7x6w5v"], "assignment"),
  masked("connection-masked", "Server=db01.internal;User ID=svc_reader;Password=Pw-0a1b2c3d;Encrypt=true", ["db01.internal", "svc_reader", "Pw-0a1b2c3d"], "connection"),
  masked("connection-masked", "Data Source=sql-02.internal;Uid=report_user;Pwd=Pw-9z8y7x6w;", ["sql-02.internal", "report_user", "Pw-9z8y7x6w"], "connection"),
  masked("upn-masked", "assigned to real.person@customer.example by the admin", ["real.person@customer.example"], "upn"),
  masked("upn-masked", "cc: ops.lead+alerts@corp.example", ["ops.lead+alerts@corp.example"], "upn"),
  masked("upn-masked", "<teacher1@school.example>", ["teacher1@school.example"], "upn"),
  ...[32, 33, 36, 39, 40, 64].map((n) => masked("hex-masked", `the opaque key ${hexRun(n, n)} rotated`, [hexRun(n, n)], "hex")),
  masked("hex-masked", `KEY ${hexRun(34, 3).toUpperCase()} end`, [hexRun(34, 3).toUpperCase()], "hex"),
  masked("hex-masked", `captured=${hexRun(35, 5)}`, [hexRun(35, 5)], "hex"),
];

const PLAIN = [
  ["case", "case create-thing"], ["screen", "on screen orders-list"], ["step", "at step 3 of 7"], ["build", "build 0122d9eaf"], ["commit", "commit abc1234"],
  ["fingerprint", "fingerprint 9f86d081884c7d65"], ["status", "ended FAIL"], ["field", "the password field is required"], ["path", "path=/srv/app/config.json"],
  ["patch", "patch=2"], ["tokens", "tokens rotate nightly"], ["short-hex", `ref ${hexRun(31, 9)}`], ["count", "42 rows"], ["secretary", "the secretary signed"],
];

const PLAIN_ROWS = [kept("plain-text-kept", PLAIN), ...PLAIN.map((fragment) => kept("plain-text-kept", [fragment]))];

const deep = (group, value, secrets, paths) => ({ group, input: { call: "scrubbed", value, planted: planted(secrets), kept: keptPaths(paths) }, expect: NOTHING });

const DEEP_ROWS = [
  deep("secret-named-key", { NAME: "TC-1", PASSWORD: "hunter2-value-x", Api_Key: "ak-value-123", nested: { client_secret: "cs-value-456" }, list: [{ token: "tk-value-789" }] }, [["PASSWORD", "hunter2-value-x"], ["Api_Key", "ak-value-123"], ["client_secret", "cs-value-456"], ["token", "tk-value-789"]], [["NAME", ["NAME"]]]),
  deep("secret-named-key", { a: ["password=pw-deep-1"], b: { c: { d: "bearer: br-deep-2" } }, n: 5, z: null }, [["a", "pw-deep-1"], ["d", "br-deep-2"]], [["n", ["n"]], ["z", ["z"]]]),
  deep("secret-named-key", { credentials: { user: "svc-user-obj", key: "k-obj-1" }, apiKey: ["ak-arr-1", "ak-arr-2"], screen: "orders-list" }, [["credentials", "svc-user-obj"], ["credentials", "k-obj-1"], ["apiKey", "ak-arr-1"], ["apiKey", "ak-arr-2"]], [["screen", ["screen"]]]),
  deep("secret-named-key", { "x-api-key": "xk-hdr-1", access_token: "at-hdr-2", REPO_PAT: "rp-hdr-3", method: "GET" }, [["x-api-key", "xk-hdr-1"], ["access_token", "at-hdr-2"], ["REPO_PAT", "rp-hdr-3"]], [["method", ["method"]]]),
  deep("plain-named-key", { screen: "orders-list", rows: 12, path: "/srv/app", patch: "2", note: "owner real.person@customer.example", ok: true }, [["note", "real.person@customer.example"]], [["screen", ["screen"]], ["rows", ["rows"]], ["path", ["path"]], ["patch", ["patch"]], ["ok", ["ok"]]]),
  deep("plain-named-key", { NAME: "TC-7", build: "0122d9eaf", steps: [{ i: 1, do: "click", target: "save" }] }, [], [["NAME", ["NAME"]], ["build", ["build"]], ["steps", ["steps"]]]),
];

const named = (key, want) => ({ group: "secret-name", input: { call: "secret-name", key }, expect: { exactly: [want ? "secret-name" : "plain-name"] } });

const NAME_ROWS = [
  ...["password", "PASSWORD", "Password", "pwd", "client_secret", "secret", "apiKey", "api_key", "api-key", "API_KEY", "x-api-key", "access_token", "refresh_token", "token", "Authorization", "bearer", "REPO_PAT", "ado_pat", "pat", "credential", "credentials", "db_credentials"].map((key) => named(key, true)),
  ...["path", "patch", "NAME", "fe_commit", "status", "screen", "compatible", "tokenizer", "secretary", "upload_path"].map((key) => named(key, false)),
];

const STRUCTURE = [["kind", ["kind"]], ["case", ["case"]], ["status", ["status"]], ["fe_commit", ["fe_commit"]], ["screen", ["screen"]], ["proved", ["proved"]], ["params.NAME", ["params", "NAME"]], ["identity.roles", ["identity", 0, "roles"]], ["resolved.sql", ["resolved", 0, "sql"]]];

const recorded = (group, record, secrets, paths) => ({ group, input: { call: "record", record, planted: planted(secrets), kept: keptPaths(paths) }, expect: NOTHING });

// A whole run record, every free-text field holding a secret, every structural field something a reader needs.
const runRecord = (group, v) => recorded(group, { kind: "run", case: v.caseId, status: v.status, fe_commit: v.commit, screen: "orders-list", proved: { ui: 1, api: 0, sql: 1 }, params: { NAME: v.name, PASSWORD: v.password, TARGET_UPN: v.upns[0] }, resolved: [{ as: "USER_ID", value: v.upns[1], sql: "SELECT Id FROM Users" }], captured: { ORDER_KEY: v.hex }, report: { note: `api_key=${v.key} was used` }, identity: [{ as: "admin", atStep: 0, upn: v.upns[2], roles: ["Category Administrator"] }], failure: `failed for ${v.upns[3]} with Bearer ${v.bearer}` }, [["params-password", v.password], ["params-upn", v.upns[0]], ["resolved-upn", v.upns[1]], ["captured-hex", v.hex], ["report-named", v.key], ["identity-upn", v.upns[2]], ["failure-upn", v.upns[3]], ["failure-bearer", v.bearer]], STRUCTURE);

const RECORD_ROWS = [
  runRecord("record-free-text", { caseId: "create-thing", status: "FAIL", commit: hexRun(40, 1), name: "TC-1", password: "hunter2-rec-1", upns: ["real.person@customer.example", "teacher1@school.example", "admin.user@customer.example", "ops.lead@corp.example"], hex: hexRun(32, 2), key: "rk-rec-1", bearer: "br-rec-1" }),
  recorded("record-free-text", { kind: "run", case: "sign-in", status: "PASS", fe_commit: "0122d9eaf", identity: [{ as: "teacher", atStep: 2, upn: "t.nguyen@school.example", roles: ["Teacher"] }, { as: "admin", atStep: 5, upn: "a.okafor@school.example", roles: ["Admin"] }] }, [["identity-upn", "t.nguyen@school.example"], ["identity-upn", "a.okafor@school.example"]], [["fe_commit", ["fe_commit"]], ["status", ["status"]], ["identity.roles", ["identity", 0, "roles"]], ["identity.as", ["identity", 1, "as"]]]),
  recorded("record-free-text", { kind: "run", case: "export-keys", status: "PASS", fe_commit: hexRun(40, 4), captured: { KEY_A: hexRun(33, 6), KEY_B: hexRun(36, 7), KEY_C: hexRun(39, 8) } }, [["captured-hex", hexRun(33, 6)], ["captured-hex", hexRun(36, 7)], ["captured-hex", hexRun(39, 8)]], [["fe_commit", ["fe_commit"]], ["case", ["case"]]]),
  recorded("record-free-text", { kind: "run", case: "list-rows", status: "FAIL", fe_commit: "abc1234", report: { rows: [{ Upn: "row.user@customer.example", password: "row-pw-1" }] }, failure: "token: tk-fail-1 expired at step 4" }, [["report-upn", "row.user@customer.example"], ["report-password", "row-pw-1"], ["failure-named", "tk-fail-1"]], [["fe_commit", ["fe_commit"]], ["status", ["status"]]]),
  recorded("record-structure", { kind: "run", case: "create-thing", status: "PASS", fe_commit: hexRun(40, 2), proved: { ui: 1, api: 1, sql: 0 }, params: { NAME: "TC-3" } }, [], [["kind", ["kind"]], ["case", ["case"]], ["status", ["status"]], ["fe_commit", ["fe_commit"]], ["proved", ["proved"]], ["params.NAME", ["params", "NAME"]]]),
  recorded("record-structure", { kind: "run", case: "create-thing", status: "PASS", fe_commit: hexRun(64, 3), screen: "orders-list", durationMs: 1234 }, [], [["fe_commit", ["fe_commit"]], ["screen", ["screen"]], ["durationMs", ["durationMs"]]]),
  recorded("record-structure", { kind: "run", case: "create-thing", status: "BLOCKED", fe_commit: "0122d9eaf", params: { NAME: "TC-9", PASSWORD: "pw-struct-1" } }, [["params-password", "pw-struct-1"]], [["fe_commit", ["fe_commit"]], ["status", ["status"]], ["params.NAME", ["params", "NAME"]]]),
];

const FIXED = [...TEXT_ROWS, ...PLAIN_ROWS, ...DEEP_ROWS, ...NAME_ROWS, ...RECORD_ROWS, { group: "free-text-declared", input: { call: "free-text" }, expect: { has: FREE.map((f) => `free:${f}`) } }];

// ---- a seeded generator, the same secrets for the same seed ---------------------------------------------------------

export function mulberry32(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    const t = Math.imul(s ^ (s >>> 15), s | 1);
    const u = (t + Math.imul(t ^ (t >>> 7), t | 61)) ^ t;
    return ((u ^ (u >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = (r, list) => list[Math.floor(r() * list.length)];

const ALNUM = [..."abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"];

const chars = (r, set, n) => Array.from({ length: n }, () => pick(r, set)).join("");

const opaque = (r) => `${chars(r, ALNUM, 6)}-${chars(r, ALNUM, 6 + Math.floor(r() * 10))}`;

const hexOf = (r, n) => chars(r, [..."0123456789abcdef"], n);

const upnOf = (r) => `${pick(r, ["ana", "binh", "chen", "dara", "emil"])}.${pick(r, ["nguyen", "okafor", "smith", "tanaka"])}${Math.floor(r() * 100)}@${pick(r, ["customer.example", "corp.example", "tenant-a.example"])}`;

const NAMED_FORMS = [(w, v) => `${w}=${v}`, (w, v) => `${w}: ${v}`, (w, v) => `{"${w}":"${v}"}`, (w, v) => `${w} = '${v}'`];

const said = (kind, text, values) => ({ kind, text, values });

// Each makes one secret of its shape, the text it sits in, and the values that must not survive.
const SECRETS = [
  (r) => ((v) => said("token", `signed in with ${v} today`, [v]))(`eyJ${chars(r, ALNUM, 12)}.${chars(r, ALNUM, 16)}.${chars(r, ALNUM, 20)}`),
  (r) => ((v) => said("basic", `sent Basic ${v} upstream`, [v]))(chars(r, ALNUM, 16 + Math.floor(r() * 16))),
  (r) => ((w, v, form) => said("named", form(w, v), [v]))(pick(r, ["password", "Password", "pwd", "secret", "token", "api_key", "apiKey", "api-key", "pat", "credential", "authorization"]), opaque(r), pick(r, NAMED_FORMS)),
  (r) => ((v) => said("bearer", `retried with Bearer ${v} after a 401`, [v]))(opaque(r)),
  (r) => ((name, v) => said("assignment", `${name}=${v} node start`, [v]))(pick(r, ["REPO_PAT", "ADO_TOKEN", "CI_SECRET", "DB_PASSWORD", "SMTP_PWD", "SERVICE_API_KEY", "VENDOR_APIKEY", "CLOUD_CREDENTIALS"]), opaque(r)),
  (r) => ((host, user, pw) => said("connection", `Server=${host};User ID=${user};Password=${pw};Encrypt=true`, [host, user, pw]))(`db-${chars(r, ALNUM, 5)}.internal`, `svc_${chars(r, ALNUM, 6)}`, opaque(r)),
  (r) => ((v) => said("upn", `assigned to ${v} by the admin`, [v]))(upnOf(r)),
  (r) => ((v) => said("hex", `the opaque key ${v} rotated`, [v]))(hexOf(r, 32 + Math.floor(r() * 33))),
];

const shuffled = (r, list) => list.map((x) => [r(), x]).sort((a, b) => a[0] - b[0]).map(([, x]) => x);

const textOf = (r, secrets, plain) => shuffled(r, [...secrets.map((s) => s.text), ...plain.map(([, value]) => value)]).join(" | ");

const seededTextRow = (r, secrets, plain) => ({ group: "seeded-text", input: { call: "scrub", text: textOf(r, secrets, plain), planted: secrets.flatMap((s) => s.values.map((value) => ({ kind: s.kind, value }))), kept: plain.map(([name, value]) => ({ name, value })) }, expect: NOTHING });

const seededText = (r) => seededTextRow(r, Array.from({ length: 1 + Math.floor(r() * 3) }, () => pick(r, SECRETS)(r)), Array.from({ length: 1 + Math.floor(r() * 2) }, () => pick(r, PLAIN)));

const seededRecord = (r) => runRecord("seeded-record", { caseId: pick(r, ["create-thing", "export-keys", "sign-in"]), status: pick(r, ["PASS", "FAIL", "BLOCKED"]), commit: hexOf(r, pick(r, [7, 9, 12, 40, 40, 64])), name: `TC-${Math.floor(r() * 90) + 10}`, password: opaque(r), upns: [upnOf(r), upnOf(r), upnOf(r), upnOf(r)], hex: hexOf(r, 32 + Math.floor(r() * 33)), key: opaque(r), bearer: opaque(r) });

// ---- all of them, numbered within their group ------------------------------------------------------------------------

const numbered = (list) => list.map((c, i, all) => ({ id: `${c.group}-${all.slice(0, i).filter((x) => x.group === c.group).length + 1}`, ...c }));

export function cases(seed, samples) {
  const r = mulberry32(seed);
  return numbered([...FIXED, ...Array.from({ length: Math.max(8, Math.floor(samples / 2)) }, () => seededText(r)), ...Array.from({ length: Math.max(4, Math.floor(samples / 4)) }, () => seededRecord(r))]);
}

// ---- the reference model, held to the contract; and every input, held to the model -----------------------------------

const HAND_SHAPES = [
  ["eyJhbGciOiJub25lIn0.eyJzdWIiOiJ4In0.", "token"], ["Basic dXNlcjpwYXNzd29yZA==", "basic"], ["password=x", "named"], ["Bearer abc", "bearer"], ["REPO_PAT=x", "assignment"],
  ["Server=db01;", "connection"], ["a.person@customer.example", "upn"], [hexRun(32), "hex"], [hexRun(31), null], ["path=/srv", null], ["patch=2", null], ["the password field", null], ["tokens rotate", null], ["fingerprint 9f86d081884c7d65", null],
];

const HAND_NAMES = [["client_secret", true], ["apiKey", true], ["REPO_PAT", true], ["Authorization", true], ["path", false], ["patch", false], ["fe_commit", false], ["compatible", false]];

const modelFindings = () => [...HAND_SHAPES.filter(([text, want]) => shapeOf(text) !== want).map(([text]) => `the reference model reads the shape of ${JSON.stringify(text)} wrong`), ...HAND_NAMES.filter(([key, want]) => secretName(key) !== want).map(([key]) => `the reference model reads the key ${key} wrong`)];

const textFindings = (c) => [...(c.input.planted.length && !shapeOf(c.input.text) ? [`${c.id} plants a secret in a text that is not secret-shaped`] : []), ...c.input.kept.filter((k) => shapeOf(k.value)).map((k) => `${c.id} keeps ${k.name}, which is secret-shaped`)];

const rowFindings = (c) => [...(c.input.call === "scrub" ? textFindings(c) : []), ...(c.input.call === "secret-name" && secretName(c.input.key) !== c.expect.exactly.includes("secret-name") ? [`${c.id} disagrees with the reference model`] : [])];

const generatorFindings = () => SECRETS.flatMap((make, i) => Array.from({ length: 24 }, (_, k) => make(mulberry32(k + 1))).filter((s) => !shapeOf(s.text) || !s.values.every((v) => s.text.includes(v))).map(() => `secret maker ${i} made a text that is not secret-shaped`));

export const selfTest = () => [...modelFindings(), ...generatorFindings(), ...[11, 4242].flatMap((seed) => cases(seed, 48).flatMap(rowFindings))];
