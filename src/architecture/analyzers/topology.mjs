// What a COMPOSITION FILE declares about the running system, as system-graph facts (ADR 0033;
// doc §4.2): each service a component, what each starts after, and each network a boundary it is
// attached to. Read and never run -- the rule the sandbox keeps for the same file (ADR 0039) --
// and read CONSERVATIVELY: only what the file states. An image's name is kept as an attribute and
// never read for what it suggests, so a service named after a product is a component and nothing
// more; what a component RUNS -- its workloads, interfaces and channels -- is not in such a file,
// and every component fact says so. A framework's own declarations reach the graph through a
// pack's extractor, and anything else through `architecture record`, with the file that shows it.
//
// `depends-on` and `attached-to` are the file's own words. No relation role fits start order or
// network membership, so no vocabulary row gives them one: they are kept, shown, and derive
// nothing -- a person who wants them to mean something adds a row to the project's vocabulary.
//
// The YAML reader is handed in (`input.yaml`, bound by the composition root): this engine's
// leaves hold no YAML parser, and architecture imports no runtime. Without one, each composition
// file found is an unknown, named.

const COMPOSE = /(^|[/:])(docker-)?compose(\.[A-Za-z0-9_-]+)*\.ya?ml$/;

const NO_COMPOSITION = "what this system is made of as running parts — no composition file (compose.yaml, docker-compose.yml) is tracked, so no component, network or start order was read; `architecture record` is how to state them, with the file that shows each";

const COMPONENT_UNKNOWN = "what this component runs — its workloads, its interfaces and the channels it publishes to or consumes from are not in a composition file; its code and its own declarations say that";

const NO_NETWORK = "which network it is on — the file names none, so the composition's own default network applies, and nothing here can name it";

const DEPENDS_UNKNOWN = "whether this is more than start order — a composition file says who starts first, never who calls whom";

const ATTACHED_UNKNOWN = "what may reach it over this network — a composition file names the network, never the traffic on it";

const NETWORK_UNKNOWN = "who talks over this network — a composition file declares it, never what crosses it";

export function topology(input) {
  const files = (input.files ?? []).filter((p) => COMPOSE.test(p)).sort();
  if (!files.length) return { facts: [], unknowns: [NO_COMPOSITION] };
  if (typeof input.yaml !== "function") return { facts: [], unknowns: [`what ${files.join(", ")} declare${files.length > 1 ? "" : "s"} — no YAML reader was handed to this analysis, so the composition was not read`] };
  const read = files.map((p) => composedOf(p, input));
  return { facts: factsOf(read), unknowns: read.flatMap((r) => r.unknowns) };
}

const isTable = (v) => typeof v === "object" && v !== null && !Array.isArray(v);

function composedOf(path, input) {
  const parsed = input.yaml(input.read(path) ?? "");
  const services = Object.entries(isTable(parsed.value?.services) ? parsed.value.services : {});
  const unknowns = [...parsed.notes.map((n) => `${path}: ${n} — what it says there was not read into the graph`), ...(services.length ? [] : [`${path} declares no service this analysis could read`])];
  return { path, services: services.map(([name, s]) => serviceOf(name, s)), networks: Object.keys(isTable(parsed.value?.networks) ? parsed.value.networks : {}), unknowns };
}

const serviceOf = (name, s) => ({ name, image: typeof s?.image === "string" ? s.image : null, built: s?.build !== undefined, dependsOn: namesOf(s?.depends_on), networks: namesOf(s?.networks) });

const namesOf = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === "string") : isTable(v) ? Object.keys(v) : []);

// One component per service NAME, whichever files declare it -- a base file and its override
// describe one service, and two facts for it would be two stories.
function factsOf(read) {
  const services = [...folded(read.flatMap((r) => r.services.map((s) => ({ ...s, paths: [r.path] })))).values()];
  const networks = networksOf(read, services);
  return [...services.flatMap(serviceFacts), ...networks.map(networkFact)];
}

function folded(services) {
  const by = new Map();
  for (const s of services) by.set(s.name, merged(by.get(s.name), s));
  return new Map([...by].sort(([a], [b]) => (a < b ? -1 : 1)));
}

const merged = (was, s) => (was ? { name: s.name, image: was.image ?? s.image, built: was.built || s.built, dependsOn: union(was.dependsOn, s.dependsOn), networks: union(was.networks, s.networks), paths: union(was.paths, s.paths) } : s);

const union = (a, b) => [...new Set([...a, ...b])].sort();

// Every network a file declares or a service is attached to, with every file that names it.
function networksOf(read, services) {
  const by = new Map();
  for (const r of read) for (const n of r.networks) by.set(n, union(by.get(n) ?? [], [r.path]));
  for (const s of services) for (const n of s.networks) by.set(n, union(by.get(n) ?? [], s.paths));
  return [...by].sort(([a], [b]) => (a < b ? -1 : 1)).map(([name, paths]) => ({ name, paths }));
}

const declared = (paths) => `${paths.join(" and ")} declare${paths.length > 1 ? "" : "s"}`;

const fromFiles = (paths) => ({ scope: paths, evidence: paths, source: "repository", confidence: "certain" });

const serviceFacts = (s) => [componentFact(s), ...s.dependsOn.map((d) => dependsFact(s, d)), ...s.networks.map((n) => attachedFact(s, n))];

const attributesOf = (s) => Object.fromEntries([["image", s.image], ["built", s.built || null]].filter(([, v]) => v !== null && v !== false));

function componentFact(s) {
  const attributes = attributesOf(s);
  return { kind: "node", key: `component:${s.name}`, nodeKind: "component", name: s.name, ...(Object.keys(attributes).length ? { attributes } : {}), statement: `${s.name} is a service ${declared(s.paths)}`, ...fromFiles(s.paths), because: "named under services in a composition file", unknowns: [COMPONENT_UNKNOWN, ...(s.networks.length ? [] : [NO_NETWORK])] };
}

const edge = (from, relation, to) => ({ kind: "relation", key: `${from} ${relation} ${to}`, relation, from, to });

const dependsFact = (s, d) => ({ ...edge(`component:${s.name}`, "depends-on", `component:${d}`), statement: `${s.name} starts after ${d}`, ...fromFiles(s.paths), because: "listed under the service's depends_on", unknowns: [DEPENDS_UNKNOWN] });

const attachedFact = (s, n) => ({ ...edge(`component:${s.name}`, "attached-to", `network:${n}`), statement: `${s.name} is attached to the ${n} network`, ...fromFiles(s.paths), because: "listed under the service's networks", unknowns: [ATTACHED_UNKNOWN] });

const networkFact = (n) => ({ kind: "node", key: `network:${n.name}`, nodeKind: "network", name: n.name, statement: `${n.name} is a network ${declared(n.paths)}`, ...fromFiles(n.paths), because: "named by a composition file, as a network or a service's", unknowns: [NETWORK_UNKNOWN] });
