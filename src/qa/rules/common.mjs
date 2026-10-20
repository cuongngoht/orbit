// Helpers every plan rule shares. A rule returns findings; an empty array is
// "nothing wrong". Findings never throw: plan-check decides what an exit code is.
export const members = (p, k) => (Array.isArray(p?.[k]) ? p[k].filter((m) => m && typeof m === "object") : []);

export const scenariosOf = (p) => members(p, "scenarios");
export const checksOf = (p) => members(p, "manual");
export const criteriaOf = (p) => members(p, "criteria");

export const at = (p, m) => `${p?.id ?? "plan"} ${m?.id ?? "?"}`;

export const filled = (v) => typeof v === "string" && v.trim().length > 0;

export const listed = (v) => Array.isArray(v) && v.filter(filled).length > 0;

// The fields of a record that must be filled in, as one table-driven check --
// so a rule says WHICH fields it needs and not how to test each one.
export const needs = (record, table, make) => Object.entries(table).filter(([k]) => !filled(record?.[k])).map(([, say]) => make(say));

export const needsListed = (record, table, make) => Object.entries(table).filter(([k]) => !listed(record?.[k])).map(([, say]) => make(say));
