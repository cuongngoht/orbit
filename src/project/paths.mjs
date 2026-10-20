// Canonical names for the machine home, reports room and current store layout.
export const HOME_DIR = ".orbit";

export const REPORTS_DIR = "reports";

// The name reaches a directory name, and Windows refuses punctuation a
// directory on another platform may legitimately carry.
export const safeName = (name) => String(name ?? "project").replace(/[^\w.-]+/g, "-");

export const STORE_LAYOUT = 3;
export const STORE_FILE = "store.json";
