// The standard .NET dependency-injection container, read off its registration
// calls -- and turned into the engine's generic WIRING records, so nothing
// downstream ever learns what `AddScoped` is.
//
//   AddScoped<IA, A>()         IA answered by A, scoped
//   AddSingleton<A>()          A answered by itself, singleton
//   AddTransient<IA>(sp => …)  IA answered by a factory the call does not name
//   AddScoped(typeof(IR<>), typeof(R<>))   the open-generic form
//   AddSingleton(sp => new C(…))           C, built directly
//   AddHttpClient<IA, A>()     a typed client: IA answered by A, transient
//   AddHttpClient("name")      a named client, and only a bare name is kept
//   AddDbContext<Ctx>()        the context, scoped
//   Configure<TOptions>(…)     an options type bound to configuration
//
// Only TYPE names come out, and a name must look like one. What configuration
// section an options type binds to, what a factory is passed, what a named
// client's base address is -- all of that is in the arguments, often a literal,
// and none of it is read: that is where connection strings and secrets live.
import { code, defines, withoutComments } from "./csharp.mjs";

const TYPE = String.raw`[A-Za-z_][\w.]*(?:<[\w.,\s]*>)?`;

const LIFETIMES = { AddScoped: "scoped", AddSingleton: "singleton", AddTransient: "transient", AddHttpClient: "transient", AddDbContext: "scoped" };

// Registrations whose ONE type argument is always what answers them: a context
// is its own service, and so is a typed client given only its class.
const SELF = new Set(["AddDbContext", "AddHttpClient"]);

const tidy = (t) => t.replace(/\s+/g, "");

// `(` then what follows: nothing is "answered by itself", `new X(` names X,
// anything else is a factory.
function answeredBy(rest, service) {
  if (/^\s*\)/.test(rest)) return service;
  return /^\s*(?:\w+\s*=>\s*)?new\s+([A-Za-z_][\w.]*)/.exec(rest)?.[1];
}

const RULES = [
  { re: new RegExp(String.raw`\.(AddScoped|AddSingleton|AddTransient|AddHttpClient|AddDbContext)\s*<\s*(${TYPE})\s*(?:,\s*(${TYPE})\s*)?>\s*\(([^\n]{0,80})`, "g"), wiring: (m) => ({ abstraction: tidy(m[2]), implementation: m[3] ? tidy(m[3]) : SELF.has(m[1]) ? tidy(m[2]) : answeredBy(m[4], tidy(m[2])), lifetime: LIFETIMES[m[1]], signals: [m[1]] }) },
  { re: new RegExp(String.raw`\.(AddScoped|AddSingleton|AddTransient)\s*\(\s*typeof\s*\(\s*(${TYPE})\s*\)\s*(?:,\s*typeof\s*\(\s*(${TYPE})\s*\))?`, "g"), wiring: (m) => ({ abstraction: tidy(m[2]), implementation: tidy(m[3] ?? m[2]), lifetime: LIFETIMES[m[1]], signals: [m[1]] }) },
  { re: /\.(AddScoped|AddSingleton|AddTransient)\s*\(\s*(?:\w+\s*=>\s*)?new\s+([A-Za-z_][\w.]*)\s*\(/g, wiring: (m) => ({ abstraction: m[2], implementation: m[2], lifetime: LIFETIMES[m[1]], signals: [m[1], m[2]] }) },
  { re: /\.Configure\s*<\s*([A-Za-z_][\w.]*)\s*>\s*\(/g, wiring: (m) => ({ abstraction: m[1], implementation: m[1], lifetime: "options", signals: ["Configure"] }) },
];

// The one literal read anywhere in this pack, and only its SHAPE is accepted:
// a bare name, short, no spaces, no punctuation a URL or a secret would need.
const NAMED_CLIENT = /\.AddHttpClient\s*\(\s*"([A-Za-z][\w.-]{0,40})"\s*[,)]/g;

export const di = {
  id: "dotnet.di",
  ecosystem: "dotnet",
  doc: "registrations with the standard dependency-injection container, as abstraction, implementation and lifetime",
  requires: [],
  extensions: [".cs"],
  triggers: ["AddScoped", "AddSingleton", "AddTransient", "AddHttpClient", "AddDbContext", "Configure<"],
  analyze: ({ text }) => registrations(text),
};

function registrations(text) {
  const c = code(text);
  const wirings = RULES.flatMap((rule) => [...c.matchAll(rule.re)].map(rule.wiring));
  const named = [...withoutComments(text).matchAll(NAMED_CLIENT)].map((m) => ({ abstraction: "HttpClient", name: m[1], lifetime: "transient", signals: ["AddHttpClient"] }));
  return { defines: defines(c), usages: [], wirings: [...wirings, ...named].map(clean) };
}

const clean = (w) => Object.fromEntries(Object.entries(w).filter(([, v]) => v !== undefined));
