import type { Rule } from "@orbit-web/governance-core";
import { describe, expect, test } from "vitest";
import { overrideRowsOf, withOverrideRows, type OverrideRow } from "./overrideRows";

const set = (rows: OverrideRow[], action: string, narrowing: OverrideRow["narrowing"]): OverrideRow[] => rows.map((r) => (r.action === action ? { ...r, narrowing } : r));

describe("an override as rows", () => {
  test("a row says the strictest narrowing written for its action; every other rule is kept as written", () => {
    const rules: Rule[] = [
      { id: "approve-web", action: "tool.web", effect: "require_approval" },
      { id: "deny-web", action: "tool.web", effect: "deny" },
      { id: "allow-connector", action: "tool.connector", effect: "allow" },
      { id: "deny-npm", action: "network.egress", resource: "registry.npmjs.org:443", effect: "deny" },
    ];
    const { rows, kept } = overrideRowsOf(rules);
    expect(rows.find((r) => r.action === "tool.web")?.narrowing).toBe("deny");
    expect(rows.find((r) => r.action === "tool.connector")?.narrowing).toBe("inherit");
    expect(rows.find((r) => r.action === "network.egress")?.narrowing).toBe("inherit");
    expect(kept.map((r) => r.id)).toEqual(["allow-connector", "deny-npm"]);
  });

  test("reading rules into rows and writing them back changes nothing the rows did not change", () => {
    const rules: Rule[] = [
      { id: "keep-me", action: "network.egress", resource: "example.com:443", effect: "deny" },
      { id: "web", action: "tool.web", effect: "require_approval", note: "ask first" },
    ];
    expect(withOverrideRows(rules, overrideRowsOf(rules).rows)).toEqual(rules);
  });

  test("a row changed keeps its rule's id and place; a row set anew is appended; a row set back to the policy drops its rule; nothing written allows", () => {
    const rules: Rule[] = [
      { id: "web", action: "tool.web", effect: "require_approval" },
      { id: "push", action: "repository.push", effect: "deny" },
    ];
    let rows = overrideRowsOf(rules).rows;
    rows = set(rows, "tool.web", "deny");
    rows = set(rows, "repository.push", "inherit");
    rows = set(rows, "workspace.execute", "require_approval");
    const written = withOverrideRows(rules, rows);
    expect(written).toEqual([
      { id: "web", action: "tool.web", effect: "deny" },
      { id: "workspace-execute", action: "workspace.execute", effect: "require_approval" },
    ]);
    expect(written.every((r) => r.effect !== "allow")).toBe(true);
  });

  test("a new rule's id never collides with one already written", () => {
    const rules: Rule[] = [{ id: "tool-web", action: "network.egress", resource: "example.com:443", effect: "deny" }];
    const written = withOverrideRows(rules, set(overrideRowsOf(rules).rows, "tool.web", "deny"));
    expect(written.map((r) => r.id)).toEqual(["tool-web", "tool-web-2"]);
  });
});
