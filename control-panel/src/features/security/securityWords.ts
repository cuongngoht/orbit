import type { CatalogListed, InEffect } from "./security.types";

export const SECURITY_PATH = "/security";

export const pinOf = (c: Pick<InEffect | CatalogListed, "catalog" | "version" | "digest">) => `${c.catalog} ${c.version} · ${c.digest.slice(0, 12)}`;

// A JSON document a person wrote, parsed here only to say whether it IS JSON before anything is sent.
export function jsonOrProblem(text: string): { value: unknown; problem: string | null } {
  try {
    return { value: JSON.parse(text), problem: null };
  } catch (e) {
    return { value: null, problem: e instanceof Error ? e.message : "not JSON" };
  }
}
