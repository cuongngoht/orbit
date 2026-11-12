// The RELATION ADAPTERS the orbit-develop pack ships (0.6.0, U3; skills/orbit-develop/relations/): each held to the
// contract src/context/relations.mjs asks, and to what its language really means -- a relative name resolves only to a
// file the tracked tree holds, an absolute one only when exactly one file could be it, and the JavaScript adapter reads
// a specifier with the very expression architecture's import analyser reads it with.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { SOURCE_FILE, SPECIFIER } from "../src/architecture/analyzers/imports.mjs";
import { adapterFindings } from "../src/context/relations.mjs";
import { treeOf } from "../src/context/refs.mjs";
import { RELATION_ADAPTERS } from "../skills/orbit-develop/relations/index.mjs";
import { JAVASCRIPT } from "../skills/orbit-develop/relations/javascript.mjs";
import { DEFAULT_FILES, MAX_CONFIG_BYTES, MAX_PATTERNS, PYTHON, RUNNER_CONFIGS, declaredTests } from "../skills/orbit-develop/relations/python.mjs";
import { FIXTURE, loginApp } from "./fakes/relations.mjs";

test("every shipped adapter holds the contract, and each detects its own files and no other's", () => {
  for (const a of RELATION_ADAPTERS) assert.deepEqual(adapterFindings(a), [], a.id);
  assert.deepEqual(RELATION_ADAPTERS.map((a) => a.id), ["javascript", "python"]);
  assert.deepEqual(["a.js", "b.tsx", "c.mjs", "d.py", "e.css", "Makefile"].map((p) => RELATION_ADAPTERS.find((a) => a.detects(p))?.id ?? null), ["javascript", "javascript", "javascript", "python", null, null]);
  assert.deepEqual(adapterFindings({ id: "half", detects: () => true }), ["a relation adapter needs specifiersOf", "a relation adapter needs resolve", "a relation adapter needs testsOf", "a relation adapter needs importersPattern"]);
});

// One definition of what an import of this family looks like: the adapter and the analyser agree on every line.
test("the JavaScript adapter reads a specifier exactly as architecture's import analyser does", () => {
  const lines = ['import { a } from "./a.js";', "const b = require('../b');", 'const c = await import("./c/index.mjs");', 'export { d } from "./d";', 'import e from "e-package";', "const f = 1;", "import './side-effect.css';"];
  for (const line of lines) assert.deepEqual(JAVASCRIPT.specifiersOf(line), SPECIFIER.exec(line) ? [SPECIFIER.exec(line)[1]] : [], line);
  assert.equal(JAVASCRIPT.detects("x.ts"), SOURCE_FILE.test("x.ts"));
  assert.deepEqual(JAVASCRIPT.specifiersOf(loginApp().files["web/src/pages/LoginPage.jsx"]), ["../components/Button.jsx", "../api/sessionClient.js"], "every import of a file, wherever its statement breaks");
});

// The commonest shape in a real frontend puts the specifier lines below its keyword. Read whole, the adapter finds each
// specifier with the analyser's own expression: the same as that expression finds on the statement written on one line.
const MULTILINE = [
  ['import {\n  a,\n  b,\n} from "./x.js";', ["./x.js"]],
  ["export {\n  c,\n} from './y';", ["./y"]],
  ['const z = require(\n  "./z"\n);', ["./z"]],
  ["const w = await import(\n  './w.mjs'\n);", ["./w.mjs"]],
  ['import def,\n{ e } from\n  "../v";', ["../v"]],
];

test("a JavaScript statement broken over lines is read whole -- and agrees with the analyser's expression on that statement in one line", () => {
  for (const [text, specs] of MULTILINE) {
    assert.deepEqual(JAVASCRIPT.specifiersOf(text), specs, text);
    assert.deepEqual(JAVASCRIPT.specifiersOf(text), [SPECIFIER.exec(text.replace(/\s*\n\s*/g, " "))?.[1]], `${text}: the analyser on one line`);
  }
  assert.deepEqual(JAVASCRIPT.specifiersOf(MULTILINE.map(([t]) => t).join("\n")), MULTILINE.flatMap(([, s]) => s), "every statement of a whole file");
});

test("a Python statement broken over lines -- a parenthesised name list or a backslash -- is read whole", () => {
  assert.deepEqual(PYTHON.specifiersOf("from a.b import (\n    x,\n    y,\n)\n"), ["a.b", "a.b.x", "a.b.y"]);
  assert.deepEqual(PYTHON.specifiersOf("from a.b import (x,\n    y)\n"), ["a.b", "a.b.x", "a.b.y"]);
  assert.deepEqual(PYTHON.specifiersOf("from app import \\\n    routes, \\\n    auth\n"), ["app", "app.routes", "app.auth"]);
  assert.deepEqual(PYTHON.specifiersOf("import a, \\\n    b.c\n"), ["a", "b.c"]);
  assert.deepEqual(PYTHON.specifiersOf("from app.routes import ("), ["app.routes"], "a line that only opens its list still names its module");
  const { files } = loginApp();
  assert.deepEqual(PYTHON.specifiersOf(files["server/tests/test_session_routes.py"]), ["app.routes", "app.routes.session_routes"]);
});

test("a relative JavaScript name resolves as written, with a source extension, or to its index -- and only to a tracked file", () => {
  const tree = treeOf(["src/a.js", "src/b.ts", "src/c/index.mjs", "src/d.tsx", "lib/e.js"]);
  assert.equal(JAVASCRIPT.resolve("./a.js", "src/x.js", tree), "src/a.js");
  assert.equal(JAVASCRIPT.resolve("./b", "src/x.js", tree), "src/b.ts");
  assert.equal(JAVASCRIPT.resolve("./c", "src/x.js", tree), "src/c/index.mjs");
  assert.equal(JAVASCRIPT.resolve("./d.js", "src/x.js", tree), "src/d.tsx", "a .js written for a .tsx source");
  assert.equal(JAVASCRIPT.resolve("../lib/e", "src/x.js", tree), "lib/e.js");
  assert.equal(JAVASCRIPT.resolve("./missing", "src/x.js", tree), null, "never a file the tree does not hold");
  assert.equal(JAVASCRIPT.resolve("left-pad", "src/x.js", tree), null, "a package is the manifest's, never a file here");
});

test("a JavaScript test goes with its file by name, and its importers are found by the name they write", () => {
  const { tree } = loginApp();
  assert.deepEqual(JAVASCRIPT.testsOf("web/src/pages/LoginPage.jsx", tree), ["web/src/pages/LoginPage.test.jsx"]);
  assert.deepEqual(JAVASCRIPT.testsOf("web/src/api/sessionClient.js", tree), []);
  assert.equal(JAVASCRIPT.importersPattern("web/src/api/sessionClient.js"), "sessionClient");
  assert.equal(JAVASCRIPT.importersPattern("web/src/api/index.js"), "api", "an index file is imported by its directory");
});

test("a Python name resolves inside its own package by its dots, and an absolute one only when exactly one file could be it", () => {
  const { files, tree } = loginApp();
  const handler = "server/app/routes/session_routes.py";
  assert.deepEqual(PYTHON.specifiersOf(files[handler]), ["..auth.session", "..auth.session.create_session", "..http", "..http.route"]);
  assert.deepEqual(PYTHON.specifiersOf(files[handler]).map((s) => PYTHON.resolve(s, handler, tree)), ["server/app/auth/session.py", null, "server/app/http.py", null]);
  assert.equal(PYTHON.resolve("app.routes.session_routes", "server/tests/test_session_routes.py", tree), handler);
  assert.equal(PYTHON.resolve(".", handler, tree), "server/app/routes/__init__.py", "the package itself");
  assert.deepEqual(PYTHON.specifiersOf("from . import x, y as z\nimport a.b, c\nfrom app import (routes,\n  auth)\n"), [".", ".x", ".y", "app", "app.routes", "app.auth", "a.b", "c"]);
  const twice = treeOf(["one/util.py", "two/util.py"]);
  assert.equal(PYTHON.resolve("util", "x.py", twice), null, "two files could be it: no guess");
  assert.equal(PYTHON.resolve("os.path", handler, tree), null, "nothing the tree holds");
});

test("a Python test goes with its module by name, and its importers are found by the module's own name", () => {
  const { tree } = loginApp();
  assert.deepEqual(PYTHON.testsOf("server/app/routes/session_routes.py", tree), ["server/tests/test_session_routes.py"]);
  assert.deepEqual(PYTHON.testsOf("server/app/auth/session.py", tree), ["server/tests/test_session.py"]);
  assert.equal(PYTHON.importersPattern("server/app/auth/session.py"), "session");
  assert.equal(PYTHON.importersPattern("server/app/auth/__init__.py"), "auth");
});

test("the fixture is the two-sided project the walk is told about", () => {
  assert.match(readFileSync(new URL("web/src/api/sessionClient.js", FIXTURE), "utf8"), /"\/api\/session"/);
  assert.match(readFileSync(new URL("server/app/routes/session_routes.py", FIXTURE), "utf8"), /"\/api\/session"/);
});

// (0.6.0, P3b) Which tests go with a Python module is what the checkout DECLARES for its test runner, and the runner's
// default only when it declares nothing -- read through the port the walk hands in, never a file of its own.
const PYLINT = ["pylint/checkers/variables.py", "tests/checkers/unittest_variables.py", "tests/checkers/test_variables.py", "tests/variables_test.py", "doc/unittest_variables.py"];
const declaring = (files, configs) => ({ tree: treeOf([...files, ...Object.keys(configs)]), read: (path) => configs[path] ?? null });

test("a Python test goes with its module by the patterns the checkout declares: setup.cfg [tool:pytest] python_files = *test_*.py links unittest_variables.py", () => {
  const { tree, read } = declaring(PYLINT, { "setup.cfg": "[metadata]\nname = pylint\n\n[tool:pytest]\ntestpaths = tests\npython_files = *test_*.py\naddopts = --strict-markers\n\n[flake8]\nmax-line-length = 100\n" });
  assert.deepEqual(PYTHON.testsOf("pylint/checkers/variables.py", tree, read), ["tests/checkers/unittest_variables.py", "tests/checkers/test_variables.py"], "the declared pattern, under the declared testpaths: doc/ is not where tests live, and *_test.py is not declared");
  assert.deepEqual(PYTHON.testsOf("pylint/checkers/variables.py", tree), ["tests/checkers/test_variables.py", "tests/variables_test.py"], "no read port: nothing declared is known, so the default");
});

test("no runner config: today's convention, test_name.py and name_test.py -- and nothing is read that the tree does not hold", () => {
  const asked = [];
  const tree = treeOf(PYLINT);
  assert.deepEqual(PYTHON.testsOf("pylint/checkers/variables.py", tree, (p) => (asked.push(p), null)), ["tests/checkers/test_variables.py", "tests/variables_test.py"]);
  assert.deepEqual(asked, [], "no config file is tracked, so none is read");
  assert.deepEqual(DEFAULT_FILES, ["test_*.py", "*_test.py"]);
});

test("a config naming another pattern links only that, from whichever file pytest would read first", () => {
  const files = ["app/variables.py", "t/check_variables.py", "t/test_variables.py", "t/variables_spec.py"];
  const toml = "[project]\nname = \"app\"\n[tool.pytest.ini_options]\npython_files = [\n  \"check_*.py\",\n  \"*_spec.py\",\n]\n[tool.black]\nline-length = 100\n";
  const pyproject = declaring(files, { "pyproject.toml": toml });
  assert.deepEqual(PYTHON.testsOf("app/variables.py", pyproject.tree, pyproject.read), ["t/check_variables.py", "t/variables_spec.py"]);
  const ini = declaring(files, { "pytest.ini": "[pytest]\npython_files =\n    check_*.py\n    # not a pattern\n", "setup.cfg": "[tool:pytest]\npython_files = *_spec.py\n" });
  assert.deepEqual(PYTHON.testsOf("app/variables.py", ini.tree, ini.read), ["t/check_variables.py"], "pytest.ini wins, and a comment line is no pattern");
  const empty = declaring(files, { "pytest.ini": "", "setup.cfg": "[tool:pytest]\npython_files = *_spec.py\n" });
  assert.deepEqual(PYTHON.testsOf("app/variables.py", empty.tree, empty.read), ["t/test_variables.py"], "an empty pytest.ini is pytest's config even without its section: the default");
  const tox = declaring(files, { "tox.ini": "[tox]\nenvlist = py3\n", "setup.cfg": "[tool:pytest]\npython_files = check_*.py\n" });
  assert.deepEqual(PYTHON.testsOf("app/variables.py", tox.tree, tox.read), ["t/check_variables.py"], "a tox.ini without [pytest] is not pytest's config");
  const literal = declaring(files, { "setup.cfg": "[tool:pytest]\npython_files = tests.py\n" });
  assert.deepEqual(PYTHON.testsOf("app/variables.py", literal.tree, literal.read), [], "a pattern with no * names no file for a source: nothing is guessed");
});

test("reading a runner's config is bounded: MAX_CONFIG_BYTES of it, MAX_PATTERNS patterns", () => {
  const many = Array.from({ length: MAX_PATTERNS + 5 }, (_, i) => `p${i}_*.py`).join(" ");
  assert.equal(declaredTests(treeOf(["setup.cfg"]), () => `[tool:pytest]\npython_files = ${many}\n`).files.length, MAX_PATTERNS);
  assert.equal(declaredTests(treeOf(["setup.cfg"]), () => `${"#".repeat(MAX_CONFIG_BYTES)}\n[tool:pytest]\npython_files = x_*.py\n`), null, "a section past the bound is not read");
  assert.deepEqual(RUNNER_CONFIGS.map((c) => c.file), ["pytest.ini", "pyproject.toml", "tox.ini", "setup.cfg"]);
});
