import { describe, expect, test } from "vitest";
import { EN_MESSAGES, interpolate, normalizeLocale, t } from "./index";

describe("i18n", () => {
  test("normalizes locale variants to supported base locale", () => {
    expect(normalizeLocale(undefined)).toBe("en");
    expect(normalizeLocale(null)).toBe("en");
    expect(normalizeLocale("en")).toBe("en");
    expect(normalizeLocale("en-US")).toBe("en");
    expect(normalizeLocale("en_GB")).toBe("en");
    expect(normalizeLocale("vi")).toBe("en");
  });

  test("interpolates variables and preserves unknown placeholders", () => {
    expect(interpolate("Hello {name}, {count} items", { name: "Ana", count: 3 })).toBe("Hello Ana, 3 items");
    expect(interpolate("Keep {missing}", {})).toBe("Keep {missing}");
  });

  test("translates registered keys and guarantees non-empty string values", () => {
    expect(t("common.app.tryAgain")).toBe("Try again");
    expect(t("common.app.noAnswer", { reason: "timeout" })).toBe("Orbit Web did not answer: timeout");
    const keys = Object.keys(EN_MESSAGES) as Array<keyof typeof EN_MESSAGES>;
    expect(keys.length).toBeGreaterThan(0);
    for (const k of keys) expect(typeof EN_MESSAGES[k]).toBe("string");
  });
});
