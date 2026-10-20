// The skill operations, against a throwaway plugin root: catalog, read, update,
// delete and backup. Path security has its own file.
import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ControlError } from "../src/errors.mjs";
import { frontmatter } from "../src/skills/frontmatter.mjs";
import { listSkills } from "../src/skills/catalog.mjs";
import { readSkill, revisionOf } from "../src/skills/read.mjs";
import { removeSkill } from "../src/skills/remove.mjs";
import { updateSkill } from "../src/skills/update.mjs";
import { problemsOf } from "../src/skills/validate.mjs";
import { fixture, link, put, skillText } from "./fixture.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const refusedWith = (code) => (e) => e instanceof ControlError && e.code === code;

test("the catalog is every direct child of skills/ holding a SKILL.md, and nothing else", (t) => {
  const { root, ctx } = fixture(t);
  const skills = listSkills(ctx);
  assert.deepEqual(skills.map((s) => s.id), ["alpha", "beta"]);
  const { modified, ...beta } = skills[1];
  assert.deepEqual(beta, { id: "beta", name: "beta", description: "Beta, not for the slash menu.", userInvocable: false, allowedTools: [], valid: true, problems: [], skillBytes: Buffer.byteLength(skillText("beta", "Beta, not for the slash menu.", "user-invocable: false\n")), files: 1, bytes: Buffer.byteLength(skillText("beta", "Beta, not for the slash menu.", "user-invocable: false\n")) });
  assert.match(modified, /^\d{4}-\d\d-\d\dT/);
  assert.equal(JSON.stringify(skills).includes(root.base), false, "no absolute path reaches the page");
});

test("a skill's weight counts every file in its directory, and a symlink inside is counted, never followed", (t) => {
  const { root, ctx } = fixture(t);
  const alpha = listSkills(ctx).find((s) => s.id === "alpha");
  assert.equal(alpha.files, 2, "SKILL.md and scripts/run.mjs");
  assert.equal(alpha.bytes, Buffer.byteLength(skillText("alpha")) + Buffer.byteLength("console.log('alpha');\n"));
  if (!link(root.outside, join(root.skills, "alpha", "escape"))) return t.skip("this machine cannot make a symlink");
  assert.equal(listSkills(ctx).find((s) => s.id === "alpha").files, 3, "the link is one entry; outside/ is not walked");
});

test("allowed-tools is read as a list or as one comma-separated line", (t) => {
  const { root, ctx } = fixture(t);
  put(join(root.skills, "alpha", "SKILL.md"), skillText("alpha", "Listed.", "allowed-tools:\n  - Read\n  - Bash(node x)\n"));
  put(join(root.skills, "beta", "SKILL.md"), skillText("beta", "Inline.", "allowed-tools: Read, Grep\n"));
  assert.deepEqual(listSkills(ctx).map((s) => s.allowedTools), [["Read", "Bash(node x)"], ["Read", "Grep"]]);
});

test("a skill whose file breaks the contract is still listed, and says it is not valid", (t) => {
  const { root, ctx } = fixture(t);
  put(join(root.skills, "gamma", "SKILL.md"), "no frontmatter at all\n");
  const gamma = listSkills(ctx).find((s) => s.id === "gamma");
  assert.equal(gamma.valid, false);
  assert.equal(gamma.name, "gamma");
});

test("every skill this repository ships holds to the validator — no rule is new", () => {
  const dirs = readdirSync(join(REPO, "skills")).filter((d) => existsSync(join(REPO, "skills", d, "SKILL.md")));
  assert.ok(dirs.length > 0);
  for (const id of dirs) assert.deepEqual(problemsOf(id, readFileSync(join(REPO, "skills", id, "SKILL.md"), "utf8")), [], id);
});

test("frontmatter reads the shapes the shipped skills use", () => {
  const front = frontmatter("---\nname: x\ndescription: >\n  one\n  two\nargument-hint: \"<a | b>\"\nallowed-tools:\n  - Read\n  - Bash(node x)\nuser-invocable: false\n---\nbody");
  assert.deepEqual(front, { name: "x", description: "one two", "argument-hint": "<a | b>", "allowed-tools": ["Read", "Bash(node x)"], "user-invocable": "false" });
  assert.equal(frontmatter("# no fence\n"), null);
  assert.equal(frontmatter("---\r\nname: crlf\r\ndescription: d\r\n---\r\n").name, "crlf");
});

test("the validator says every problem at once, and one sentence when there is no frontmatter", () => {
  assert.deepEqual(problemsOf("alpha", skillText("alpha")), []);
  assert.equal(problemsOf("alpha", "no fence").length, 1);
  const many = problemsOf("alpha", "---\nname: other\ndescription: has <tag> in it\nuser-invocable: maybe\n---\n");
  assert.equal(many.length, 3, many.join("\n"));
  assert.match(many.join("\n"), /directory is "alpha"/);
  assert.match(many.join("\n"), /angle brackets/);
  assert.match(many.join("\n"), /true or false/);
  assert.deepEqual(problemsOf("alpha", "---\nname: alpha\n---\n"), ["the frontmatter has no description"]);
});

test("reading a skill returns its metadata, the whole SKILL.md and a revision", (t) => {
  const { ctx } = fixture(t);
  const alpha = readSkill(ctx, "alpha");
  assert.equal(alpha.content, skillText("alpha"));
  assert.equal(alpha.revision, revisionOf(skillText("alpha")));
  assert.deepEqual(alpha.problems, []);
  assert.throws(() => readSkill(ctx, "nope"), refusedWith("SKILL_NOT_FOUND"));
  assert.throws(() => readSkill(ctx, "no-skill-md"), refusedWith("SKILL_NOT_FOUND"));
});

test("a valid update replaces SKILL.md, leaves no temporary file, and returns the fresh skill", (t) => {
  const { root, ctx } = fixture(t);
  const before = readSkill(ctx, "alpha");
  const next = skillText("alpha", "A better description.");
  const after = updateSkill(ctx, "alpha", { content: next, revision: before.revision });
  assert.equal(readFileSync(join(root.skills, "alpha", "SKILL.md"), "utf8"), next);
  assert.equal(after.description, "A better description.");
  assert.notEqual(after.revision, before.revision);
  assert.deepEqual(readdirSync(join(root.skills, "alpha")).sort(), ["SKILL.md", "scripts"]);
});

test("an invalid update is refused with every problem, and the file on disk is untouched", (t) => {
  const { root, ctx } = fixture(t);
  const file = join(root.skills, "alpha", "SKILL.md");
  const original = readFileSync(file);
  for (const content of ["no frontmatter", skillText("renamed"), "---\nname: alpha\n---\n", skillText("alpha", "has <b>xml</b>")]) {
    assert.throws(() => updateSkill(ctx, "alpha", { content }), (e) => refusedWith("INVALID_SKILL")(e) && e.kind === "invalid" && e.details.length > 0);
    assert.ok(readFileSync(file).equals(original), content);
  }
  assert.throws(() => updateSkill(ctx, "alpha", { content: 42 }), refusedWith("INVALID_BODY"));
  assert.throws(() => updateSkill(ctx, "alpha", null), refusedWith("INVALID_BODY"));
});

test("a save based on a revision that is no longer on disk is refused, not merged over", (t) => {
  const { root, ctx } = fixture(t);
  const opened = readSkill(ctx, "alpha");
  writeFileSync(join(root.skills, "alpha", "SKILL.md"), skillText("alpha", "Edited by someone else meanwhile."));
  assert.throws(() => updateSkill(ctx, "alpha", { content: skillText("alpha", "Mine."), revision: opened.revision }), refusedWith("STALE_SKILL"));
  assert.equal(readSkill(ctx, "alpha").description, "Edited by someone else meanwhile.");
});

test("a write that cannot land leaves the old SKILL.md whole", { skip: process.platform === "win32" || process.getuid?.() === 0 }, (t) => {
  const { root, ctx } = fixture(t);
  const dir = join(root.skills, "alpha");
  chmodSync(dir, 0o555);
  try {
    assert.throws(() => updateSkill(ctx, "alpha", { content: skillText("alpha", "Never lands.") }), refusedWith("WRITE_FAILED"));
    assert.equal(readFileSync(join(dir, "SKILL.md"), "utf8"), skillText("alpha"));
  } finally {
    chmodSync(dir, 0o755);
  }
});

test("delete backs the WHOLE directory up first, then removes all of it", (t) => {
  const { root, ctx } = fixture(t);
  const answer = removeSkill(ctx, "alpha");
  assert.deepEqual(answer, { id: "alpha", deleted: true, backup: "2026-09-23T10-15-30-123Z/alpha" });
  assert.equal(existsSync(join(root.skills, "alpha")), false);
  const kept = join(root.backups, "2026-09-23T10-15-30-123Z", "alpha");
  assert.equal(readFileSync(join(kept, "SKILL.md"), "utf8"), skillText("alpha"));
  assert.equal(readFileSync(join(kept, "scripts", "run.mjs"), "utf8"), "console.log('alpha');\n");
  assert.deepEqual(listSkills(ctx).map((s) => s.id), ["beta"]);
});

test("no backup, no deletion: a backup room that cannot be written stops the delete", (t) => {
  const { root, ctx } = fixture(t);
  put(join(root.base, "store-is-a-file"), "x");
  assert.throws(() => removeSkill({ ...ctx, backupRoot: join(root.base, "store-is-a-file", "skills") }, "alpha"), refusedWith("BACKUP_FAILED"));
  assert.equal(readFileSync(join(root.skills, "alpha", "SKILL.md"), "utf8"), skillText("alpha"));
  assert.ok(existsSync(join(root.skills, "alpha", "scripts", "run.mjs")));
});

test("a backup never overwrites an older one, and the delete stops rather than lose it", (t) => {
  const { root, ctx } = fixture(t);
  put(join(root.backups, "2026-09-23T10-15-30-123Z", "alpha", "SKILL.md"), "an older backup\n");
  assert.throws(() => removeSkill(ctx, "alpha"), refusedWith("BACKUP_FAILED"));
  assert.ok(existsSync(join(root.skills, "alpha", "SKILL.md")));
  assert.equal(readFileSync(join(root.backups, "2026-09-23T10-15-30-123Z", "alpha", "SKILL.md"), "utf8"), "an older backup\n");
});

test("deleting a skill that does not exist is a 404-kind refusal and touches nothing", (t) => {
  const { root, ctx } = fixture(t);
  assert.throws(() => removeSkill(ctx, "nope"), (e) => refusedWith("SKILL_NOT_FOUND")(e) && e.kind === "missing");
  assert.throws(() => removeSkill(ctx, "no-skill-md"), refusedWith("SKILL_NOT_FOUND"));
  assert.ok(existsSync(join(root.skills, "no-skill-md", "README.md")));
  assert.equal(existsSync(root.backups), false);
});
