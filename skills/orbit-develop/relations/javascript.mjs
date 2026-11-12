// The relation adapter for JavaScript and TypeScript sources (0.6.0, U3; the contract is src/context/relations.mjs).
//
// What a file imports is read with the SAME expression architecture's import analyser reads it with
// (src/architecture/analyzers/imports.mjs `SPECIFIER`): a relative `from "…"`, `require("…")` or `import("…")`. A bare
// specifier names a package, which the manifests already say, and is never a file here. The text is read WHOLE, so a
// statement broken over lines (`import {\n  a,\n} from "./x"`, `require(\n  "./y"\n)`) is found wherever it breaks. A relative one resolves the way
// the module resolvers do it -- the path as written, then with each source extension, then its index file -- and only to
// a file the tracked tree holds. A test goes with a file when it is called `<name>.test.*` or `<name>.spec.*`.
import { SOURCE_FILE, SPECIFIER } from "../../../src/architecture/analyzers/imports.mjs";

const EVERY = new RegExp(SPECIFIER.source, "g");

const EXTENSIONS = [".js", ".mjs", ".cjs", ".jsx", ".ts", ".tsx"];

const dirOf = (p) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");

const baseOf = (p) => p.slice(p.lastIndexOf("/") + 1);

const stemOf = (p) => baseOf(p).replace(/\.[^.]+$/, "");

// POSIX, by hand: git's spelling on every platform.
const step = (acc, part) => (part === ".." ? acc.slice(0, -1) : part === "." || part === "" ? acc : [...acc, part]);

const joined = (dir, spec) => `${dir}/${spec}`.split("/").reduce(step, []).join("/");

// A `.js` written for a `.ts` source is the compiler's convention: the same stem in each source extension.
const withoutJs = (base) => (/\.[cm]?js$/.test(base) ? base.replace(/\.[cm]?js$/, "") : null);

const candidates = (base) => [base, ...EXTENSIONS.map((e) => `${base}${e}`), ...EXTENSIONS.map((e) => `${base}/index${e}`), ...(withoutJs(base) ? EXTENSIONS.map((e) => `${withoutJs(base)}${e}`) : [])];

export const specifiersOf = (text) => [...String(text ?? "").matchAll(EVERY)].map((m) => m[1]);

export const resolve = (spec, from, tree) => (String(spec).startsWith(".") ? candidates(joined(dirOf(from), spec)).find((p) => tree.files.has(p)) ?? null : null);

const TEST = (stem) => new RegExp(`^${stem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.(test|spec)\\.[cm]?[jt]sx?$`);

export const testsOf = (path, tree) => ((test) => [...tree.files].filter((p) => test.test(baseOf(p))))(TEST(stemOf(path)));

// Who imports `a/b/name.js` writes `name` on that line; an index file is imported by its directory's name.
export const importersPattern = (path) => (stemOf(path) === "index" ? baseOf(dirOf(path)) || null : stemOf(path));

export const JAVASCRIPT = Object.freeze({ id: "javascript", detects: (path) => SOURCE_FILE.test(String(path)), specifiersOf, resolve, testsOf, importersPattern });
