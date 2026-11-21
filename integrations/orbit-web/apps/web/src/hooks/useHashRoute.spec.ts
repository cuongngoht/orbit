import { describe, expect, test } from "vitest";
import { hrefOf, officeHref, parseRoute } from "./useHashRoute";

const EMP = "e1000000-0000-4000-8000-000000000001";
const MISSION = "a1000000-0000-4000-8000-000000000001";

describe("the page's place, in the URL hash", () => {
  test("every office place survives a reload: the hash it is written as reads back as the same place", () => {
    for (const hash of [
      "#/office",
      "#/office/work",
      "#/office/inbox",
      "#/office/schedule",
      `#/office/employee/${EMP}`,
      `#/office/employee/${EMP}/resources`,
      `#/office/mission/${MISSION}`,
      `#/office/mission/${MISSION}/handoffs`,
      "#/office/work?settings=ai-connections",
      "#/?settings=compute",
      "#/governance/policy/rev-2",
      `#/chat/${EMP}`,
      "#/",
    ])
      expect(hrefOf(parseRoute(hash))).toBe(hash);
  });

  test("an office detail without its record, or a page that does not exist, is the overview", () => {
    expect(parseRoute("#/office/employee").view).toEqual({ view: "office", page: "overview", item: null, tab: null });
    expect(parseRoute("#/office/nowhere").view).toEqual({ view: "office", page: "overview", item: null, tab: null });
    expect(parseRoute("#/office/work/extra").view).toEqual({ view: "office", page: "work", item: null, tab: null });
  });

  test("the office's own links, and the two new sections of Settings", () => {
    expect(officeHref("employee", EMP, "resources")).toBe(`#/office/employee/${EMP}/resources`);
    expect(officeHref("inbox")).toBe("#/office/inbox");
    expect(parseRoute("#/office?settings=ai-connections").settings).toBe("ai-connections");
    expect(parseRoute("#/settings/compute").settings).toBe("compute");
  });
});
