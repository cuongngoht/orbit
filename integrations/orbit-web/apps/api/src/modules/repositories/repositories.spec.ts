import assert from "node:assert/strict";
import { test } from "node:test";
import type { Repository } from "@orbit-web/contracts";
import { mergeRepositories, orderBranches } from "./repositories.module.js";

const repo = (fullName: string, updatedAt: string | null, extra: Partial<Repository> = {}): Repository => ({ fullName, owner: fullName.split("/")[0] as string, name: fullName.split("/")[1] as string, private: false, defaultBranch: "main", updatedAt, archived: false, fork: false, ...extra });

test("the two listings merge into one, newest first, a repository once", () => {
  const merged = mergeRepositories([[repo("me/a", "2026-01-01T00:00:00Z")], [repo("ME/A", "2026-01-01T00:00:00Z", { private: true }), repo("org/b", "2026-02-01T00:00:00Z")]]);
  assert.deepEqual(merged.map((r) => [r.fullName, r.private]), [["org/b", false], ["ME/A", true]]);
});

test("the default branch comes first, then the rest by name", () => {
  const ordered = orderBranches([{ name: "zeta", protected: false, commit: null, isDefault: false }, { name: "main", protected: true, commit: null, isDefault: true }, { name: "alpha", protected: false, commit: null, isDefault: false }]);
  assert.deepEqual(ordered.map((b) => b.name), ["main", "alpha", "zeta"]);
});
