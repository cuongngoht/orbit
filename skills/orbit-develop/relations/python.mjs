// The relation adapter for Python sources (0.6.0, U3; the contract is src/context/relations.mjs).
//
// `import a.b` and `from a.b import c` name a module; `from .a import b` and `from . import b` name one relative to the
// importing file's own package (a dot per level). A relative name resolves inside that package; an absolute one
// resolves only when EXACTLY ONE tracked file ends in its path (`a/b.py`, or `a/b/__init__.py`) -- two candidates are
// two guesses, and none is taken. A name imported FROM a module may itself be a module (`from app import routes`), so
// each is offered both ways and only what the tree holds resolves. A test goes with `name.py` when it is called
// `test_name.py` or `name_test.py`.
const FROM = /^[ \t]*from[ \t]+(\.*[\w.]*)[ \t]+import[ \t]+(?:\(([^)]*)\)|([\w \t,]+))/gm;
const IMPORT = /^[ \t]*import[ \t]+([\w.]+(?:[ \t]*,[ \t]*[\w.]+)*)/gm;

const dirOf = (p) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");

const baseOf = (p) => p.slice(p.lastIndexOf("/") + 1);

const stemOf = (p) => baseOf(p).replace(/\.py$/, "");

const names = (list) => list.split(",").map((n) => n.trim().split(/\s+/)[0]).filter(Boolean);

const joinedName = (mod, name) => (/^\.+$/.test(mod) ? `${mod}${name}` : `${mod}.${name}`);

const fromSpecs = (m) => [m[1], ...names(m[2] ?? m[3]).map((n) => joinedName(m[1], n))].filter(Boolean);

export const specifiersOf = (text) => [...[...String(text ?? "").matchAll(FROM)].flatMap(fromSpecs), ...[...String(text ?? "").matchAll(IMPORT)].flatMap((m) => names(m[1]))];

const moduleFiles = (base) => [`${base}.py`, `${base}/__init__.py`];

// `from ..a import b` in pkg/sub/x.py: one dot is pkg/sub, each more dot a level up.
const packageOf = (from, dots) => dirOf(from).split("/").slice(0, Math.max(0, dirOf(from).split("/").length - (dots - 1))).join("/");

const relativeBase = (spec, from) => ((dots) => [packageOf(from, dots), ...spec.slice(dots).split(".").filter(Boolean)].filter(Boolean).join("/"))(/^\.+/.exec(spec)[0].length);

const relative = (spec, from, tree) => moduleFiles(relativeBase(spec, from)).find((p) => tree.files.has(p)) ?? null;

const endsIn = (p, tail) => p === tail || p.endsWith(`/${tail}`);

const absolute = (spec, tree) => ((tails) => ((hits) => (hits.length === 1 ? hits[0] : null))([...tree.files].filter((p) => tails.some((t) => endsIn(p, t)))))(moduleFiles(spec.split(".").join("/")));

export const resolve = (spec, from, tree) => (String(spec).startsWith(".") ? relative(String(spec), from, tree) : absolute(String(spec), tree));

export const testsOf = (path, tree) => ((stem) => [...tree.files].filter((p) => [`test_${stem}.py`, `${stem}_test.py`].includes(baseOf(p))))(stemOf(path));

// Who imports `pkg/name.py` writes `name` on that line; a package's `__init__.py` is imported by its directory's name.
export const importersPattern = (path) => (stemOf(path) === "__init__" ? baseOf(dirOf(path)) || null : stemOf(path));

export const PYTHON = Object.freeze({ id: "python", detects: (path) => /\.py$/.test(String(path)), specifiersOf, resolve, testsOf, importersPattern });
