import type { Selection, Verdict } from "./mcp.types";

// The closed vocabularies a control on these pages offers, as typed lists, and
// the guards that turn what a <select> or a tab hands back -- a string, or
// `unknown` -- into one of them without a cast.
export const SELECTIONS: readonly Selection[] = ["automatic", "approval", "disabled"];
export const VERDICTS: readonly Verdict[] = ["allow", "approval", "deny"];
export const TRANSPORTS: readonly ("http" | "stdio")[] = ["http", "stdio"];

export const isSelection = (value: unknown): value is Selection => SELECTIONS.some((s) => s === value);
export const isVerdict = (value: unknown): value is Verdict => VERDICTS.some((v) => v === value);
export const isTransport = (value: unknown): value is "http" | "stdio" => TRANSPORTS.some((t) => t === value);
