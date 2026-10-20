// A command is launched as an argument list or not at all: what needs a shell
// is refused with the sentence that says which part, and never half-run.
import { test } from "node:test";
import assert from "node:assert/strict";
import { filled, safeName, tokenize } from "../src/runtime/discover/commands.mjs";

test("words, with quotes holding a word together", () => {
  assert.deepEqual(tokenize("dotnet run --launch-profile http"), { argv: ["dotnet", "run", "--launch-profile", "http"], unsafe: null });
  assert.deepEqual(tokenize(`serve --title "My App" --flag='a b' x`).argv, ["serve", "--title", "My App", "--flag=a b", "x"]);
  assert.deepEqual(tokenize(`say ""`).argv, ["say", ""]);
  assert.deepEqual(tokenize("  padded   words  ").argv, ["padded", "words"]);
});

test("a value holding ; is ONE argument when quoted -- and a shell operator when it is not", () => {
  assert.deepEqual(tokenize(`echo "a;b"`).argv, ["echo", "a;b"]);
  assert.deepEqual(tokenize(`echo 'a|b && c'`).argv, ["echo", "a|b && c"]);
  assert.match(tokenize("build && test").unsafe, /uses "&", which needs a shell/);
  assert.match(tokenize("a; b").unsafe, /";"/);
  assert.match(tokenize("cat x | grep y").unsafe, /"\|"/);
  assert.match(tokenize("run > out.txt").unsafe, /">"/);
});

test("what a shell would expand is refused: variables, substitutions, globs, a home directory, braces", () => {
  assert.match(tokenize("echo $HOME").unsafe, /"\$"/);
  assert.match(tokenize("echo `date`").unsafe, /"`"/);
  assert.match(tokenize(`echo "$HOME"`).unsafe, /inside quotes/);
  assert.match(tokenize("lint src/**/*.js").unsafe, /"\*"/);
  assert.match(tokenize("ls ~/work").unsafe, /"~"/);
  assert.match(tokenize("cp {a,b} dir").unsafe, /"\{"/);
  assert.deepEqual(tokenize("cd a~b").argv, ["cd", "a~b"], "a tilde inside a word is just a character");
  assert.match(tokenize("tool C:\\x\\y").unsafe, /"\\"/);
  assert.match(tokenize("tool %HOME%\\x").unsafe, /%VARIABLE%|"\\"/);
});

test("an environment prefix is refused -- it is where a credential gets typed", () => {
  const out = tokenize("API_TOKEN=abc123 npm start");
  assert.deepEqual(out.argv, []);
  assert.match(out.unsafe, /environment variable before the command/);
  assert.deepEqual(tokenize("tool --opt=value").argv, ["tool", "--opt=value"], "an = inside a later word is an argument");
});

test("empty, over-long, over-wide and unclosed are said", () => {
  assert.match(tokenize("").unsafe, /empty/);
  assert.match(tokenize("   ").unsafe, /empty/);
  assert.match(tokenize(null).unsafe, /empty/);
  assert.match(tokenize("x ".repeat(1200)).unsafe, /longer than 2048/);
  assert.match(tokenize(Array.from({ length: 70 }, (_, i) => `w${i}`).join(" ")).unsafe, /more than 64 words/);
  assert.match(tokenize(`echo "never closed`).unsafe, /quote that never closes/);
});

test("a script name is carried into a template only when it is a plain name", () => {
  assert.deepEqual([safeName("dev"), safeName("test:unit"), safeName("start:https"), safeName("a.b-c_d")], [true, true, true, true]);
  assert.deepEqual([safeName("--flag"), safeName("a b"), safeName("a;b"), safeName(""), safeName("$(x)"), safeName("x".repeat(200))], [false, false, false, false, false, false]);
  assert.deepEqual(filled(["npm", "run", "{name}"], "test:unit"), ["npm", "run", "test:unit"]);
  assert.equal(filled(["npm", "run", "{name}"], "--evil"), null);
});
