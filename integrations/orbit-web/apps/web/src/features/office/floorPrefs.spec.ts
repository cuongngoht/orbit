import { afterEach, describe, expect, test } from "vitest";
import { employeeCard } from "../../testing/officeFixtures";
import { DEFAULT_FLOOR_PREFS, ROOM_ACCENTS, accentForDepartment, formatElapsed, needsAttention, readFloorPrefs } from "./floorPrefs";
import { personaFor } from "./VirtualDesk";

afterEach(() => {
  window.localStorage.clear();
});

describe("floorPrefs utilities", () => {
  test("accentForDepartment honors custom accent index and falls back to deterministic hash", () => {
    const custom = accentForDepartment("d1", "Engineering", { deptAccents: { d1: 2 } });
    expect(custom).toBe(ROOM_ACCENTS[2]);

    const invalid = accentForDepartment("d1", "Engineering", { deptAccents: { d1: 999 } });
    expect(invalid).toBe(accentForDepartment(null, "Engineering"));
  });

  test("formatElapsed formats seconds, minutes, hours, and days cleanly", () => {
    const base = Date.parse("2026-11-25T10:00:00.000Z");
    expect(formatElapsed(null, base)).toBeNull();
    expect(formatElapsed("not-a-date", base)).toBeNull();
    expect(formatElapsed("2026-11-25T09:59:40.000Z", base)).toBe("<1m");
    expect(formatElapsed("2026-11-25T09:48:00.000Z", base)).toBe("12m");
    expect(formatElapsed("2026-11-25T07:45:00.000Z", base)).toBe("2h 15m");
    expect(formatElapsed("2026-11-24T07:00:00.000Z", base)).toBe("1d 3h");
  });

  test("needsAttention flags waiting_review, waiting_info, waiting_resources, not_ready, or connectionWarning", () => {
    expect(needsAttention(employeeCard({ workLabel: "ready", connectionWarning: null }))).toBe(false);
    expect(needsAttention(employeeCard({ workLabel: "working", connectionWarning: null }))).toBe(false);
    expect(needsAttention(employeeCard({ workLabel: "waiting_review" }))).toBe(true);
    expect(needsAttention(employeeCard({ workLabel: "waiting_info" }))).toBe(true);
    expect(needsAttention(employeeCard({ workLabel: "waiting_resources" }))).toBe(true);
    expect(needsAttention(employeeCard({ workLabel: "not_ready" }))).toBe(true);
    expect(needsAttention(employeeCard({ workLabel: "ready", connectionWarning: "Token expired" }))).toBe(true);
  });

  test("readFloorPrefs safely falls back to defaults on corrupt storage", () => {
    window.localStorage.setItem("orbit.office.floorPrefs.v1", "{bad-json");
    expect(readFloorPrefs()).toEqual(DEFAULT_FLOOR_PREFS);
  });

  test("personaFor produces distinct visual traits per employee and respects customizations", () => {
    const alex = personaFor("Alex Chen", undefined, "emp-alex");
    const minh = personaFor("Minh Tran", undefined, "emp-minh");
    const diffCount =
      Number(alex.shirt !== minh.shirt) +
      Number(alex.hair !== minh.hair) +
      Number(alex.hairStyle !== minh.hairStyle) +
      Number(alex.accessory !== minh.accessory) +
      Number(alex.outfitStyle !== minh.outfitStyle);
    expect(diffCount).toBeGreaterThanOrEqual(2);

    const custom = personaFor("Alex Chen", { shirt: 3, hair: 2, hairStyle: 4, accessory: 3 }, "emp-alex");
    expect(custom.hairStyle).toBe(4);
    expect(custom.accessory).toBe(3);
  });
});
