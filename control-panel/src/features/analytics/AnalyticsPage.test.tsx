// The Analytics page, through the whole app. .test.tsx: see SkillsPage.test.tsx.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";
import { fakeServer, fakeSkill } from "../../testing/fakeServer";
import { renderApp } from "../../testing/renderApp";

beforeEach(() => {
  window.sessionStorage.setItem("orbit.control.token", "tok-123");
  vi.stubGlobal(
    "fetch",
    fakeServer([
      fakeSkill("alpha", { description: "a".repeat(400), skillBytes: 2048, allowedTools: ["Read", "Edit"] }),
      fakeSkill("beta", { description: "b".repeat(1100), skillBytes: 10240 }),
      fakeSkill("broken", { valid: false, problems: ["the frontmatter has no name"] }),
    ]).fetch,
  );
});

const figure = (name: string) => screen.getByRole("heading", { level: 2, name }).closest("figure") as HTMLElement;

describe("Analytics page", () => {
  it("leads with the headline numbers, each one explained", async () => {
    renderApp("/analytics");
    const main = within(await screen.findByRole("main"));
    expect(await main.findByRole("link", { name: /^Skills 3 / })).toBeTruthy();
    expect(main.getByRole("link", { name: /^Needs attention Warning:\s?2 / })).toBeTruthy();
    expect(main.getByRole("link", { name: /^Largest SKILL\.md 10\.0 KB beta, loaded when it runs/ })).toBeTruthy();
  });

  it("plots every skill as a link, largest first, and marks the one over the limit in words", async () => {
    renderApp("/analytics");
    await screen.findByRole("heading", { level: 2, name: "Description length" });
    const rows = within(figure("Description length")).getAllByRole("listitem");
    expect(rows.map((r) => r.getAttribute("href"))).toEqual(["/skills/beta", "/skills/alpha", "/skills/broken"]);
    expect(within(rows[0]).getByText(/over limit/)).toBeTruthy();
  });

  it("every chart has a table view with the same values", async () => {
    renderApp("/analytics");
    await screen.findByRole("heading", { level: 2, name: "SKILL.md size" });
    const views = within(figure("SKILL.md size")).getByRole("toolbar", { name: "SKILL.md size view" });
    fireEvent.click(within(views).getByRole("radio", { name: "Table" }));
    const table = within(figure("SKILL.md size")).getByRole("table", { name: "SKILL.md size" });
    expect(within(table).getByText("10.0 KB")).toBeTruthy();
    expect(within(table).getByText("2.0 KB")).toBeTruthy();
  });

  it("puts what needs doing above the numbers, with where to go", async () => {
    renderApp("/analytics");
    const banner = (await screen.findByText("2 skills need attention")).closest("[role=group]") as HTMLElement;
    expect(within(banner).getByRole("link", { name: "Review in Skills" }).getAttribute("href")).toBe("/skills?show=attention");
    expect(screen.getByRole("heading", { level: 2, name: "Needs attention" })).toBeTruthy();
  });

  it("says all clear once: no banner, and no empty attention card", async () => {
    vi.stubGlobal("fetch", fakeServer([fakeSkill("alpha")]).fetch);
    renderApp("/analytics");
    await screen.findByText("Every skill holds to the contract and its limits");
    expect(screen.queryByText(/needs? attention$/)).toBeNull();
    expect(screen.queryByRole("heading", { level: 2, name: "Needs attention" })).toBeNull();
    expect(screen.getByRole("heading", { level: 2, name: "Recently changed" })).toBeTruthy();
  });

  it("marks only the tiles that open something", async () => {
    vi.stubGlobal("fetch", fakeServer([fakeSkill("alpha")]).fetch);
    renderApp("/analytics");
    const main = within(await screen.findByRole("main"));
    const skills = await main.findByRole("link", { name: /^Skills 1 / });
    expect(skills.querySelector("svg")).toBeTruthy();
    const onDisk = main.getByText("On disk").closest("div") as HTMLElement;
    expect(onDisk.querySelector("svg")).toBeNull();
  });

  it("says what each skill may do without asking", async () => {
    renderApp("/analytics");
    const table = await screen.findByRole("table", { name: "Pre-approved tools per skill" });
    const alpha = within(table).getByRole("link", { name: "alpha" }).closest("tr") as HTMLElement;
    expect(within(alpha).getAllByText("Yes")).toHaveLength(2);
  });

  it("the attention tile goes straight to the skills that need it", async () => {
    const router = renderApp("/analytics");
    const tile = (await screen.findByText("Open the list to see why")).closest("a") as HTMLElement;
    fireEvent.click(tile);
    expect(await screen.findByRole("heading", { level: 1, name: "Skills" })).toBeTruthy();
    expect(router.state.location.search).toBe("?show=attention");
    // The tile said 2, and 2 is what it opens: the invalid one AND the one over the limit.
    expect(screen.getByRole("link", { name: "broken" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "beta" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "alpha" })).toBeNull();
  });
});
