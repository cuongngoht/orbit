// The derivations behind the Analytics page, pure. .test.tsx: see SkillsPage.test.tsx.
import { describe, expect, it } from "vitest";
import { fakeSkill } from "../../testing/fakeServer";
import { DESCRIPTION_LIMIT, analyse, capabilitiesOf, scaleFor } from "./analytics";

describe("analyse", () => {
  const skills = [
    fakeSkill("alpha", { allowedTools: ["Read", "Grep"], skillBytes: 2048, files: 3, bytes: 5000, modified: "2026-09-20T00:00:00.000Z" }),
    fakeSkill("beta", { userInvocable: false, allowedTools: ["Edit", "Write", "Bash(node x)", "AskUserQuestion"], skillBytes: 4096, files: 1, bytes: 4096, modified: "2026-09-22T00:00:00.000Z" }),
    fakeSkill("gamma", { valid: false, problems: ["the frontmatter has no name"], description: "x".repeat(DESCRIPTION_LIMIT + 1), allowedTools: [], modified: "2026-09-21T00:00:00.000Z" }),
  ];
  const a = analyse(skills);

  it("counts the catalog", () => {
    expect([a.total, a.userInvocable, a.files, a.bytes]).toEqual([3, 2, 5, 5000 + 4096 + skills[2].bytes]);
    expect(a.descriptionChars).toBe(skills.reduce((n, s) => n + s.description.length, 0));
  });

  it("lists every reason a skill needs attention, and keeps the server's problems", () => {
    expect(a.attention.map((x) => [x.id, x.kind])).toEqual([
      ["gamma", "invalid"],
      ["gamma", "long-description"],
    ]);
    expect(a.attention[0].details).toEqual(["the frontmatter has no name"]);
  });

  it("sorts bars largest first, and names the largest SKILL.md", () => {
    expect(a.sizes.map((b) => b.id)).toEqual(["beta", "alpha", "gamma"]);
    expect(a.largest).toEqual({ id: "beta", value: 4 });
  });

  it("reads what a skill may do without asking off its allowed-tools, most able first", () => {
    expect(capabilitiesOf(skills[0])).toEqual(["reads"]);
    expect(capabilitiesOf(skills[1])).toEqual(["edits", "runs", "asks"]);
    expect(a.permissions.map((p) => p.id)).toEqual(["beta", "alpha", "gamma"]);
  });

  it("lists recent changes newest first", () => {
    expect(a.recent.map((s) => s.id)).toEqual(["beta", "gamma", "alpha"]);
  });
});

describe("scaleFor", () => {
  it("picks clean ticks that cover the data with room for the value label", () => {
    expect(scaleFor([819, DESCRIPTION_LIMIT])).toEqual({ max: 1200, ticks: [0, 300, 600, 900, 1200] });
    expect(scaleFor([17.5])).toEqual({ max: 20, ticks: [0, 5, 10, 15, 20] });
    expect(scaleFor([]).max).toBeGreaterThan(0);
  });
});
