import type { Checkout } from "./projects.types";

export const PROJECTS_PATH = "/projects";

/** The route below Projects that names one checkout's runtime. */
export const RUNTIME_ROUTE = ":key/checkouts/:checkout/runtime";

// Identity lives in the PATH, in both parts, and nowhere else: a page about a checkout is about the
// one its address names, so a bookmark, a second tab and a reload all mean the same thing.
export const runtimePath = (key: string, checkout: string) => `${PROJECTS_PATH}/${encodeURIComponent(key)}/checkouts/${encodeURIComponent(checkout)}/runtime`;

const lastSegment = (path: string) => path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;

// A checkout, as a person tells two apart: its directory's name and the branch it was last on.
export const checkoutLabel = (c: Checkout) => `${lastSegment(c.root)}${c.summary?.branch ? ` · ${c.summary.branch}` : ""}${c.exists ? "" : " (missing)"}`;
