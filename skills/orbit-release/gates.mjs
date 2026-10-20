// The repo's definition of done, as DATA -- one row per gate.
//
// It is five separate commands, and the way a bad release happens is that
// somebody runs four of them. A stale schema/case.schema.json or three version fields
// that disagree are both invisible until a consuming repo pulls the plugin and
// `query check` starts complaining about a vocabulary it has never seen.
//
// `run` is injected, so the deciding half of this file is pure and tested
// without spawning anything. ship.mjs binds it to a real process.

const FIXTURE = "test/fixtures/ui-tests";

export const GATES = [
  {
    name: "the suite passes, and says how many tests that was",
    check: (run) => counted(run(["--test"])),
  },
  {
    name: "every line holds to Five Lines",
    check: (run) => matched(run(["cli/check-five-lines.mjs", "src", "cli", "skills", "--strict"]), /^0 finding\(s\)/m, "the lint reported findings"),
  },
  {
    name: "the fixture project is clean, and check says so with its exit code",
    check: (run) => clean(run(["cli/query.mjs", "check"], { ORBIT_UI_TESTS: FIXTURE })),
  },
  {
    name: "the fixture plans are clean, and plan-check says so with its exit code",
    check: (run) => planned(run(["cli/plan-check.mjs"], { ORBIT_UI_TESTS: FIXTURE })),
  },
  {
    name: "schema/case.schema.json is what the generator produces",
    check: (run) => same(run(["cli/schema.mjs"]), FIXTURE + "/schema/case.schema.json"),
  },
  {
    name: "schema/plan.schema.json is what the generator produces",
    check: (run) => same(run(["cli/schema.mjs", "--plan"]), FIXTURE + "/schema/plan.schema.json"),
  },
  {
    name: "package.json, plugin.json and marketplace.json agree on the version",
    check: (run) => agreed(run(["-e", VERSIONS])),
  },
  {
    name: "the archive a host will accept: layout, manifest, and plain descriptions",
    check: (run) => packaged(run(["-e", ARCHIVE])),
  },
  // A host that cannot parse a skill's frontmatter strips it and ships the skill nameless and toolless (1.8.8's
  // orbit-engineering-agent, one list item out of its indent): asked of every SKILL.md and agent, by line.
  {
    name: "every skill and agent opens with frontmatter a host can parse",
    check: (run) => parsedFrontmatter(run(["skills/orbit-release/frontmatter.mjs"])),
  },
  {
    name: "no compatibility layer ships: no adapter module, no legacy alias",
    check: (run) => counted(run(["--test", "test/no-compat-layer.test.mjs"])),
  },
];

// Printed by the child, because only the child knows where it is installed.
// FIVE files. The root plugin.json carries a version too, and it was not in
// this list -- so it sat at 1.4.1 through two releases with nothing to notice;
// the Codex manifest made it five. A gate that checks some of them agreeing is
// a gate that reports agreement. Then every other entry of the marketplace: it
// ships with the release.
const VERSIONS = 'const v=require("./package.json").version,a=require("./.claude-plugin/plugin.json").version,m=require("./.claude-plugin/marketplace.json").plugins,b=m[0].version,c=require("./plugin.json").version,d=require("./.codex-plugin/plugin.json").version;console.log([v,a,b,c,d,...m.slice(1).map((p)=>p.version)].join(" "))';

// What a HOST refuses, asked here rather than learned from a rejected upload.
// Every rule cost a release to discover:
//
//   a top-level bin/  the CLI puts that directory on PATH, while the approval
//                     surface a team's admin reads never mentions it -- so the
//                     host refuses to be the thing that adds it. Hence cli/.
//   <angle brackets>  a description that reads as XML is refused outright. The
//                     placeholder that belongs in argument-hint does not belong
//                     in the sentence a host renders.
//   a SYMLINK         "Zip file contains a symbolic link" -- refused whatever it
//                     points at, because a link is a path the host cannot vouch
//                     for. This repository keeps one on purpose, for
//                     a historical transport, and .gitattributes keeps it out.
//                     So the rule here is not "no symlinks": it is that a
//                     tracked symlink must be export-ignored, which is the only
//                     question the archive actually asks.
//   > 1024 characters a description longer than that is refused: "field
//                     'description' in SKILL.md must be at most 1024 characters".
//   > 500 characters  the PLUGIN's own description, in .claude-plugin/plugin.json,
//                     has a tighter limit than a skill's: "Plugin description
//                     must be at most 500 characters" (1.6.3's first upload).
//
// Every skill AND every agent is read, because a rule a host applies to one
// component is a rule about the archive, not about skills.
const ARCHIVE = `
const fs = require("fs");
const bad = [];
for (const path of [".codex-plugin/plugin.json", "hooks/codex.json", ".agents/plugins/marketplace.json", "hooks/grok.json"]) if (!fs.existsSync(path) || ignored(path)) bad.push(path + ": required native package asset missing or excluded");
if (fs.existsSync("bin")) bad.push("a top-level bin/ is back — a host rejects the archive for it; the entry points belong in cli/");
if (!fs.existsSync(".claude-plugin/plugin.json")) bad.push("no .claude-plugin/plugin.json — nothing declares the plugin");
const pluginSays = fs.existsSync(".claude-plugin/plugin.json") ? String(JSON.parse(fs.readFileSync(".claude-plugin/plugin.json", "utf8")).description ?? "") : "";
if (pluginSays.length > 500) bad.push(".claude-plugin/plugin.json: the plugin description is " + pluginSays.length + " characters — a host refuses more than 500");
for (const f of shippedLinks()) bad.push(f + ": a symlink reaches the archive — the host refuses it outright, saying the zip file contains a symbolic link. Add the path to .gitattributes as export-ignore, or make it a real file");
for (const f of declared()) {
  const said = /^description:([\\s\\S]*?)\\n(?:[a-z-]+:|---)/m.exec(fs.readFileSync(f, "utf8"));
  if (said && /<[a-zA-Z\\/][^>]*>/.test(said[1])) bad.push(f + ": the description reads as XML (<tag>) — a host refuses it; a placeholder belongs in argument-hint");
  if (said && folded(said[1]).length > 1024) bad.push(f + ": the description is " + folded(said[1]).length + " characters — a host refuses more than 1024");
}
// Asked of git, not of the filesystem: the question is what git archive will
// PUT IN THE ZIP, and export-ignore is the only thing that decides that. A walk
// over the working tree would report the two links this repository keeps on
// purpose and would fail every release.
// (No backticks in here -- this whole script is a template literal.)
function shippedLinks() {
  const listed = git(["ls-files", "-s"]).split("\\n").filter((l) => l.startsWith("120000"));
  const links = listed.map((l) => l.split("\\t")[1]).filter(Boolean);
  return links.length ? links.filter((f) => !ignored(f)) : [];
}

// Declarations, not const arrows: the checks above run before this point, and a
// const is in its temporal dead zone until the line that defines it.
function ignored(f) {
  return / export-ignore: set$/.test(git(["check-attr", "export-ignore", "--", f]).trim());
}

function git(args) {
  return require("child_process").execFileSync("git", args, { encoding: "utf8" });
}

// The description as the host reads it: a folded block (>) joins its lines with
// one space, so what is counted is the sentence, not the indentation.
function folded(raw) {
  return raw.replace(/^\\s*[>|][-+]?/, "").replace(/\\s+/g, " ").trim().replace(/^(["'])([\\s\\S]*)\\1$/, "$2");
}

function declared() {
  const skills = fs.readdirSync("skills").map((d) => "skills/" + d + "/SKILL.md");
  const agents = fs.readdirSync("agents").map((f) => "agents/" + f);
  return [...skills, ...agents].filter((f) => fs.existsSync(f));
}
console.log(bad.join("; ") || "ok");
`;

// Each check answers {ok, detail} -- never throws, so one failing gate still
// lets the rest report and a reader sees the whole picture at once.
export function report(run, gates = GATES) {
  return gates.map((g) => ({ name: g.name, ...verdict(g, run) }));
}

function verdict(g, run) {
  try {
    return g.check(run);
  } catch (e) {
    return { ok: false, detail: e.message };
  }
}

export const shippable = (rows) => rows.every((r) => r.ok);

// `node --test` exits 0 with "fail 0"; the count is what the DoD asks to be
// reported, so it is pulled out rather than left for someone to read.
//
// Which CHARACTER starts that line is the runner's business and changes with
// Node: TAP writes "# tests 140", and the spec reporter — the default from Node
// 24, even into a pipe — writes "ℹ tests 140". Reading only the first spelling
// failed the whole definition of done with "printed no count" on a new Node,
// about a suite that had just passed.
const count = (out, name) => new RegExp(`^[#ℹ] ${name} (\\d+)$`, "m").exec(out)?.[1] ?? null;

// A skipped test is printed as a COUNT beside the passes: a machine without an
// interpreter the report parts need skips those tests, and a green gate must
// say how much of the suite it did not run (CI, which requires them, runs all).
function counted(r) {
  const tests = count(r.out, "tests");
  const failed = count(r.out, "fail");
  if (tests === null || failed === null) return { ok: false, detail: "node --test printed no count" };
  return failed === "0" ? { ok: true, detail: `${tests} tests${skippedOf(r.out)}` } : { ok: false, detail: `${failed} of ${tests} failing${named(r.out)}` };
}

const skippedOf = (out) => ((n) => (n && n !== "0" ? `, ${n} skipped` : ""))(count(out, "skipped"));

// A count with no NAME sends whoever reads CI back to their own machine to
// guess -- and a failure that happens on one OS only is exactly the one they
// cannot reproduce there. The runner already printed which test it was; the gate
// was throwing that away and reporting the number alone.
//
// The NAME alone was still not enough, for the same reason one step further: it
// says which assertion broke and not what it saw. A Windows-only failure read
// from a Linux machine is a guess either way, and the two defects this matrix
// exists for were both of that kind. So the failing assertion comes with it.
//
// Both spellings, because the reporter changes with Node: TAP writes
// "not ok 3 - <name>", the spec reporter writes "✖ <name> (12.3ms)".
const FAILED = /^(?:not ok \d+ - |✖ )(.+)$/gm;

const named = (out) => {
  const hits = [...out.matchAll(FAILED)].map((m) => [withoutTiming(m[1]), why(out, m.index)]);
  const said = [...new Map(hits).entries()].map(([name, reason]) => `${name}${reason}`);
  return said.length ? `\n        ${said.join("\n        ")}` : "";
};

const withoutTiming = (name) => name.replace(/ \(\d+(?:\.\d+)?ms\)$/, "").trim();

// What the runner said about THIS failure: the text between this "not ok" and
// the next one, which is where both reporters put the error.
//
// THREE lines, not one. "Expected values to be strictly equal:" on its own is a
// sentence with no facts in it -- the line that matters is the one underneath
// holding the two values, and that is the whole point of printing any of this.
function why(out, at) {
  const block = out.slice(at, nextFailure(out, at));
  const said = /^\s*error:\s*(?:\|-)?[ \t]*\n?([\s\S]*)$/m.exec(block);
  return said ? saidLines(said[1]) : "";
}

// Stops at the next TAP key, because everything after it is bookkeeping a
// reader did not ask for -- a stack into node:internal helps nobody.
const TAP_KEY = /^(?:code|stack|failureType|expected|actual|operator|name|\.\.\.)\s*:/;

function saidLines(text) {
  const all = text.split("\n").map((l) => l.trim());
  const upTo = all.slice(0, all.findIndex((l) => TAP_KEY.test(l)) + 1 || all.length);
  return upTo.filter(Boolean).slice(0, 3).map((l) => `\n          ${l.slice(0, 140)}`).join("");
}

function nextFailure(out, at) {
  const rest = out.slice(at + 1);
  const found = /^(?:not ok \d+ - |✖ )/m.exec(rest);
  return found ? at + 1 + found.index : out.length;
}

const matched = (r, want, says) => (want.test(r.out) ? { ok: true, detail: firstLine(r.out) } : { ok: false, detail: says });

// The exit code is the half that only recently started meaning anything, so it
// is what this gate reads -- findings on stdout with a 0 would be the old bug.
function clean(r) {
  const found = /(\d+) hard finding\(s\)/.exec(r.out);
  if (r.code !== 0 || found) return { ok: false, detail: `${found?.[1] ?? "some"} hard finding(s) — run query check` };
  return { ok: true, detail: firstLine(r.out) };
}

// The plan gate reads the same two halves `clean` does -- the exit code AND the
// count -- because plan-check deliberately exits 0 on advisories, so a summary
// line alone could not tell an advisory from an error.
function planned(r) {
  const summary = /(\d+) plan\(s\), (\d+) error\(s\)[^\n]*/.exec(r.out);
  if (r.code !== 0 || (summary && summary[2] !== "0")) return { ok: false, detail: `${summary?.[2] ?? "some"} error(s) — run node cli/plan-check.mjs` };
  return { ok: true, detail: summary?.[0] ?? "no plans" };
}

// Compared line-ending-insensitively for the same reason query/check.mjs is:
// git hands the file back with the CHECKOUT's endings -- CRLF on Windows -- and
// the generator always produces \n. A byte comparison called every Windows
// clone stale, which is a gate that fails for being run on the wrong OS.
function same(r, file) {
  const disk = r.read(file);
  if (disk === null) return { ok: false, detail: `${file} is missing` };
  return lf(disk) === lf(r.out) ? { ok: true, detail: "in sync" } : { ok: false, detail: "stale — run node cli/schema.mjs --write" };
}

const lf = (s) => s.replace(/\r\n/g, "\n").trim();

// `version` rides alongside `detail` because the CLI needs the VALUE while the
// reader needs the sentence. When detail was the only field the CLI fed the
// sentence to bump(), which answered "1.0.0-beta — a prerelease…2".
function agreed(r) {
  const [v, a, b, c, ...more] = r.out.trim().split(/\s+/);
  if (!(v && v === a && a === b && b === c && more.every((version) => version === v))) return { ok: false, detail: `package ${v}, plugin ${a}, marketplace ${b}, root plugin ${c}` };
  return { ok: true, version: v, detail: prereleaseOf(v) ? `${v} — a prerelease, so nothing in it is a promise yet` : v };
}

// The child answers "ok", or the sentence naming what a host would refuse --
// so a failure tells the reader what to move, not which predicate was false.
function packaged(r) {
  const said = firstLine(r.out);
  return said === "ok" ? { ok: true, detail: "no top-level bin/, a manifest, descriptions plain, a skill's ≤ 1024 characters and the plugin's ≤ 500" } : { ok: false, detail: said };
}

const firstLine = (out) => out.trim().split("\n").filter(Boolean)[0] ?? "";

function parsedFrontmatter(r) {
  const said = firstLine(r.out);
  return said === "ok" ? { ok: true, detail: "every SKILL.md and agent holds to the frontmatter shape a host parses" } : { ok: false, detail: said || r.err || "the frontmatter check said nothing" };
}

// Which bump a change earns, from the repo's own rule: changing a published
// contract is major, adding to one is minor. There is no third answer, and
// guessing is how a consuming repo gets a breaking change in a patch.
//
// A PRERELEASE is the exception, and not a special case so much as the rule read
// properly: the rule is about published contracts, and a prerelease publishes
// none. So a breaking change during one earns no major bump -- there is nothing
// yet to break -- it advances the prerelease. `release` is what ends it.
export function bump(version, change) {
  const pre = prereleaseOf(version);
  if (change === "release") return base(version);
  if (pre) return `${base(version)}-${nextPre(pre)}`;
  return next(base(version), change);
}

function prereleaseOf(version) {
  const at = String(version).indexOf("-");
  return at < 0 ? null : String(version).slice(at + 1);
}

const base = (version) => String(version).split("-")[0];

// beta -> beta.2 -> beta.3. The first one carries no number, because "beta.1"
// reads like there was a beta.0.
function nextPre(pre) {
  const numbered = /^(.*)\.(\d+)$/.exec(pre);
  if (!numbered) return `${pre}.2`;
  return `${numbered[1]}.${Number(numbered[2]) + 1}`;
}

function next(version, change) {
  const [major, minor, patch] = version.split(".").map(Number);
  if (change === "changed") return `${major + 1}.0.0`;
  if (change === "added") return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}
