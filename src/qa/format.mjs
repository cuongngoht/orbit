// Shared bits of the plan views. Printing is a view concern and stays here.
export const out = (...a) => console.log(...a);

export const pad = (s, n) => String(s ?? "").padEnd(n);

// A ratio with no denominator prints as "—", never as 100%.
export const pct = (r) => (r.pct === null ? "—" : `${r.pct}%`);

export const ratioLine = (r) => `  ${pad(r.name, 20)} ${pad(`${r.n}/${r.of}`, 8)} ${pad(pct(r), 5)}  of ${r.scope}`;

export const bullet = (s) => `  - ${s}`;

export const heading = (s) => `\n${s}`;

export const noPlan = (ref) => out(`no plan "${ref}" — try: qa-plan plans`);
