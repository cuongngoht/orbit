// A run INSIDE an isolated worker (ADR 0038): what the request says, how its refs are bound,
// and how a capability's helper is launched there.
//
// The host dispatches a worker with ONE request on stdin (orbit.worker/v1) and reads back one
// envelope; the worker runs the frozen case with the same runner a person's run uses. Nothing
// the worker can reach is authoritative: its store is a scratch room in its own output, and the
// host validates the envelope and writes the ledger, the evidence and the investigation's line
// itself (src/run/envelope.mjs). What the worker is handed is SEALED: the binding table the host
// resolved (no URL a case typed, no address a model guessed) and the secrets an identity needs,
// on stdin only -- they reach a helper's environment and nothing else.
import { join } from "node:path";
import { asCapability } from "../adapters/dispatch.mjs";
import { selectAdapter } from "../adapters/select.mjs";
import { helperFacade } from "../capability/helper.mjs";
import { catalogFile, readCatalog, rowsOf } from "../catalog.mjs";
import { Blocked, Refused } from "../errors.mjs";
import { contained } from "../project/boundary.mjs";

export const WORKER_API = "orbit.worker/v1";

const REQUEST_RULES = [
  { when: (r) => r?.v !== WORKER_API, say: `the request is not ${WORKER_API}` },
  { when: (r) => typeof r.runId !== "string" || typeof r.nonce !== "string", say: "the request names no runId and nonce" },
  { when: (r) => typeof r.case?.file !== "string" || typeof r.case?.digest !== "string", say: "the request names no frozen case file and digest" },
  { when: (r) => typeof r.out !== "string", say: "the request names no output directory" },
];

export const requestProblem = (r) => REQUEST_RULES.find((rule) => rule.when(r))?.say ?? null;

// The run-case arguments the request stands for: the frozen case BY PATH and its synthetic
// params. Evidence goes to the evidence room of the worker's own scratch store, inside its
// output, where the host lists it. Never a flag the request did not earn.
export function argvOf(r) {
  const params = Object.entries(r.params ?? {}).map(([k, v]) => `${k}=${v}`);
  return [r.case.file, ...params, "--json", ...(r.slice ? [`--from=${r.slice.from}`, `--to=${r.slice.to}`] : [])];
}

// The binder a worker gets: only what the host sealed, by kind and alias. Every secret a bound value
// NAMES -- its `env`, or a credential's user, password or token variable -- is handed back as
// environment for the helper, the only place it may go; a name the host sealed no value for is not.
//
// An identity the host could not issue (nothing on the host reaches an isolated sandbox's hooks) is
// sealed as how to issue it (`issue`): the binder issues it HERE, once per alias for the run, through
// `deps.issue` -- bound by the composition root to the adapter that speaks the identity hooks'
// protocol -- and its token joins the helper's environment and nothing else. The value a capability
// is handed never carries how it was issued.
export const sealedBinder = (r, deps = {}) => ((issued) => ({ resolve: (kind, ref) => sealed(r, kind, ref, { ...deps, issued }) }))(new Map());

function sealed(r, kind, ref, deps) {
  const value = r.bindings?.[kind]?.[ref];
  if (!value) return { ok: false, why: `nothing named ${String(ref).slice(0, 60)} is bound as ${kind} for this run` };
  const token = value.issue ? issuedOnce(r, value, deps) : null;
  if (token?.why) return { ok: false, why: token.why };
  return { ok: true, value: withoutIssue(value), env: { ...envOf(r, secretNamesOf(value)), ...(token ? { [value.env]: token.token } : {}) } };
}

const envOf = (r, names) => Object.fromEntries(names.filter((n) => r.secrets?.[n] !== undefined).map((n) => [n, String(r.secrets[n])]));

const secretNamesOf = (value) => [value.env, ...Object.values(value.credential ?? {})].filter((n) => typeof n === "string" && n);

const withoutIssue = (value) => Object.fromEntries(Object.entries(value).filter(([k]) => k !== "issue"));

// Issued once for the run: a second call that binds the same identity is the same principal, not a second one.
function issuedOnce(r, value, deps) {
  if (!deps.issued.has(value.alias)) deps.issued.set(value.alias, typeof deps.issue === "function" ? deps.issue(value, envOf(r, secretNamesOf(value.issue))) : { why: `${value.alias} is issued inside the sandbox, and nothing here can issue it` });
  return deps.issued.get(value.alias);
}

// -> (value, env) => { token } | { why }: an identity issued through the adapter selection picks for the identity
// hooks' protocol, by the helper facade -- the same bounded helper protocol a pack's capability uses.
export const identityIssuer = (ctx) => (value, env) => issuedBy(ctx, value, env);

function issuedBy(ctx, value, env) {
  const chosen = selectAdapter(ctx.adapters, { family: "identity", op: "issue", transport: value.issue.transport });
  if (chosen.gap) return { why: chosen.gap.why };
  const answer = askedSafely(() => helperFacade(ctx, null, asCapability(chosen.adapter), { bound: { identityRef: { ...value.issue, principal: value.principal, tenant: value.tenant } }, env }).run("issue", {}));
  return typeof answer?.token === "string" ? { token: answer.token } : { why: answer?.why ?? "the identity hooks issued no token" };
}

function askedSafely(fn) {
  try { return fn(); }
  catch (e) { return { why: e.message }; }
}

// How a helper is started where the runner runs, as an argument list, in the directory that
// declared it, under the minimal environment the composition root hands in (`base.node`,
// `base.env` -- src/ reads no process state of its own). Where a helper LIVES is the loader's to
// say: it names the home of every extension it registered that declares a helper (`home`), a
// pack's from where the plugin keeps it. A helper that wants an image of its own is not started
// here.
export function localLauncher(pluginRoot, io, base = {}) {
  const homes = new Map();
  return { launch: (cap, op) => launched(pluginRoot, io, base, homes, cap), home: (from, home) => homed(homes, String(from), home) };
}

// A home is recorded ONCE, and only for an extension's own id. A pack is found only where the
// plugin's catalog says it is -- nothing a project's room holds can stand in for one -- and a
// second home for an id already recorded (a candidate being verified, a room edited by hand) never
// replaces the first.
const OWN_ID = /^[a-z0-9][a-z0-9-]*$/;

function homed(homes, from, home) {
  if (!OWN_ID.test(from) || homes.has(from)) return;
  homes.set(from, home);
}

function launched(pluginRoot, io, base, homes, cap) {
  const from = String(cap?.from ?? "");
  const home = from.startsWith("pack:") ? packHome(pluginRoot, io, from) : homes.get(from) ?? null;
  const argv = cap?.helper?.argv ?? [];
  if (!home || !argv.length || cap.helper.runIn === "image") return { why: home ? "it runs in an image of its own, which this launcher does not start" : "nothing here knows where its helper lives — only a pack or an extension this context loaded can be launched" };
  return { env: { ...(base.env ?? {}) }, cwd: home.dir, ...LAUNCHES.find((row) => row.when(String(argv[0]))).as(home, argv, base) };
}

// What a helper's first argument IS decides how it starts: a Node script of its directory runs
// under the Node binary the composition root named; a program inside its directory runs as
// itself; a bare name is a tool on PATH -- in any language, with its own SDK -- and only one the
// extension DECLARED in its manifest's `tools`, so `query doctor` can say it is missing first.
const LAUNCHES = [
  { when: (first) => /\.(mjs|cjs|js)$/i.test(first), as: (home, argv, base) => (base.node ? { file: base.node, args: [inside(home, argv[0]), ...argv.slice(1)] } : { why: "no Node binary was named to run its script" }) },
  { when: (first) => /[\\/]/.test(first), as: (home, argv) => ({ file: inside(home, argv[0]), args: argv.slice(1) }) },
  { when: () => true, as: (home, argv) => ((home.tools ?? []).includes(argv[0]) ? { file: argv[0], args: argv.slice(1) } : { why: `its helper is the program "${String(argv[0]).slice(0, 40)}", which its manifest does not declare in tools` }) },
];

const inside = (home, path) => contained(home.dir, join(home.dir, path));

function packHome(pluginRoot, io, from) {
  const dir = packDir(pluginRoot, io, from);
  return dir ? { dir, tools: [] } : null;
}

function packDir(pluginRoot, io, from) {
  if (!from.startsWith("pack:")) return null;
  const row = rowsOf(readCatalog(io, catalogFile(pluginRoot, "packs")).packs).find((p) => p.id === from.slice(5));
  return row ? contained(pluginRoot, join(pluginRoot, row.dir)) : null;
}

// ── a PAGE run's browser (doc §15.1) ───────────────────────────────────────
// Opened in the worker before the case runs and closed after it: a blank session of its own in the run directory,
// nothing copied into it, and ONE route over every request the page makes, written by the engine:
//
//   a WRITE (anything but GET, HEAD or OPTIONS) goes through only when a grant this run was minted covers its method
//   and path on the bound origin, and no more times than the grant allows -- anything else is aborted, whoever it is
//   for (ADR 0037: a test writes only through a grant, and a page is no exception)
//   a request to the bound ORIGIN is fetched with the approved identity's credential and no redirect followed, so the
//   browser follows a redirect itself, as a new request this same route decides again -- a credential never rides a
//   redirect to another host, and never goes to another host on the task's network at all
//
// The credential is issued here (the sealed binding's `issue`). The route reaches the CLI as a FILE of the worker's
// own scratch (`io.scratch`, a tmpfs the host never reads) removed as soon as it is loaded: never an argument a process
// listing shows, never the run directory, which is in the scratch store the host reads back. What the CLI echoes of it
// is dropped, and a failure says only that it failed.
// A service worker would answer a page's requests before the route sees them, so the context runs with none.
export const PAGE_BROWSER = Object.freeze({ browser: { browserName: "chromium", isolated: true, launchOptions: { headless: true, chromiumSandbox: false, args: ["--disable-dev-shm-usage"] }, contextOptions: { serviceWorkers: "block" } } });

// io: { write(file, text), scratch(text) -> path, remove(path) } -- the composition root's; this decides what.
export function openedPage(ctx, request, io) {
  if (request.page.origin !== ctx.config.origin) throw new Refused("the page's origin is not the origin the project was laid in with — a worker opens only the interface the host bound");
  io.write(join(ctx.browser.dir(), ".playwright", "cli.config.json"), `${JSON.stringify(PAGE_BROWSER)}\n`);
  quietly(() => ctx.browser.cli(["open", "about:blank"]), "the page's browser could not be opened");
  routed(ctx, request, io);
}

function routed(ctx, request, io) {
  const file = io.scratch(pageRoute(request.page.origin, request.page.identityRef ? credentialOf(ctx, request.page) : {}, pageWritesOf(request, io.now())));
  try { quietly(() => ctx.browser.cli(["run-code", `--filename=${file}`]), "the page's browser could not be given its route"); }
  finally { io.remove(file); }
}

function credentialOf(ctx, page) {
  const bound = ctx.binder.resolve("identity", page.identityRef);
  if (!bound.ok) throw new Blocked(`the page's identity ${page.identityRef} could not be bound: ${bound.why}`);
  return headerOf(bound);
}

function headerOf(bound) {
  const token = bound.env?.[bound.value.env];
  if (!token) throw new Blocked("the page's identity was bound and no credential was issued for it — its browser would act as nobody");
  return { [String(bound.value.header ?? "authorization").toLowerCase()]: `${bound.value.scheme ?? "Bearer"} ${token}` };
}

export const PAGE_GRANT = "orbit.page.request";

// The writes the page may make: one per page grant THIS run was minted, unexpired, for the identity the page acts as
// -- the predicates the ledger holds a call to (src/run/grants.mjs) -- for its method and path, as many times as it
// allows, and no later than it expires (skills/orbit-qa/ports.mjs pageWrites).
export const pageWritesOf = (request, nowMs) => (request.grants ?? []).filter((g) => g?.capability?.id === PAGE_GRANT && g.run === request.runId && nowMs < g.expiresAtMs && (g.principal ?? null) === (request.page?.identityRef ?? null)).map((g) => ({ grant: g.id, method: String(g.operation?.selectors?.method ?? "").toUpperCase(), match: String(g.operation?.selectors?.match ?? "$^"), uses: Number(g.bounds?.maxUses) || 1, until: g.expiresAtMs }));

const literal = (v) => JSON.stringify(v);

// The script the CLI runs. Everything in it is the engine's, and every value is a JSON literal.
// A grant a write spends is kept on the browser's context (SPENDS), where the worker reads it back after the run
// (`pageSpendsOf`) and records it as the ledger records a call's: the host holds every spend to what it minted. A
// WebSocket is refused outright: a frame is a write no grant can describe.
export const pageRoute = (origin, headers, writes) => `async (page) => {
  const ORIGIN = ${literal(origin)}; const HEADERS = ${literal(headers)}; const WRITES = ${literal(writes)};
  const READS = ["GET", "HEAD", "OPTIONS"];
  const context = page.context();
  const spends = (context.${SPENDS} = context.${SPENDS} ?? []);
  const sameOrigin = (u) => u === ORIGIN || u.startsWith(ORIGIN + "/");
  await context.routeWebSocket("**/*", (ws) => ws.close({ code: 1008, reason: "a page's websocket is not a write a grant can cover" }));
  await context.route("**/*", async (route) => {
    const request = route.request();
    const method = request.method().toUpperCase();
    if (!READS.includes(method)) {
      const grant = WRITES.find((w) => w.method === method && sameOrigin(request.url()) && new RegExp(w.match).test(request.url()) && w.uses > 0 && Date.now() < w.until);
      if (!grant) return route.abort("blockedbyclient");
      grant.uses -= 1;
      spends.push({ grant: grant.grant, method });
    }
    if (!sameOrigin(request.url())) return route.continue();
    const response = await route.fetch({ headers: { ...request.headers(), ...HEADERS }, maxRedirects: 0 });
    return route.fulfill({ response });
  });
  return "ok";
}
`;

const SPENDS = "__orbitPageSpends";

// What the page's writes spent, read back off the browser's context after the run.
export function pageSpendsOf(ctx) {
  const raw = ctx.browser.cli(["--raw", "run-code", `async (page) => JSON.stringify(page.context().${SPENDS} ?? [])`], true);
  return listOf(parsedOnce(parsedOnce(String(raw ?? "").trim())));
}

const listOf = (v) => (Array.isArray(v) ? v.filter((x) => typeof x?.grant === "string") : []);

function parsedOnce(text) {
  try { return typeof text === "string" ? JSON.parse(text) : text; }
  catch { return null; }
}

// Each spend as the ledger records a call's (src/run/grants.mjs): the grant, its capability and operation, which use,
// and the digest of what it was minted for.
export const pageSpendRecords = (spends, grants) => spends.map((s, n) => ((g) => ({ kind: "grant", grant: s.grant, capability: PAGE_GRANT, operation: "write", use: spends.slice(0, n + 1).filter((x) => x.grant === s.grant).length, input_digest: g?.input?.digest ?? null }))((grants ?? []).find((g) => g.id === s.grant)));

function quietly(fn, why) {
  try { fn(); }
  catch { throw new Blocked(`${why} — nothing about the product was observed`); }
}

export const closedPage = (ctx) => ctx.browser.cli(["close"], true);
