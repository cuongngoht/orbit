// How the screen is shared. A TIER by width says how wide the label column is and whether a row's right-hand
// cells and its detail rows are drawn; below 60×12 nothing is drawn but a message. ROOM says how many rows each
// section may have (RECENT takes what is left), and when the terminal is short PRIORITY says who keeps their
// minimum: the stage and the recent lines first, the notices last. Sections stay in their screen order.
export const TIERS = Object.freeze([
  { name: "too-small", when: (c, r) => c < 60 || r < 12, label: 0, right: false, detail: false, short: true },
  { name: "wide", when: (c) => c >= 120, label: 11, right: true, detail: true, short: false },
  { name: "medium", when: (c) => c >= 90, label: 11, right: false, detail: true, short: false },
  { name: "narrow", when: () => true, label: 5, right: false, detail: false, short: true },
]);

export const tierOf = (columns, rows) => TIERS.find((t) => t.when(columns, rows));

// The share of a row's width its right-hand cells may take (frame.mjs cuts them to it).
export const RIGHT_SHARE = 0.4;

export const LABELS = Object.freeze({ stage: ["STAGE", "ST"], activity: ["ACTIVITY", "NOW"], workflow: ["WORKFLOW", "WF"], engineer: ["ENGINEER", "ENG"], verify: ["VERIFY", "VER"], qa: ["QA", "QA"], improvement: ["IMPROVE", "IMP"], sandbox: ["SANDBOX", "SBX"], recent: ["RECENT", "NEW"], notices: ["NOTICES", "LOG"] });

export const ROOM = Object.freeze({ stage: [1, 3], activity: [2, 9], workflow: [1, 4], engineer: [1, 7], verify: [2, 10], qa: [1, 6], improvement: [1, 8], sandbox: [4, 12], notices: [1, 4], recent: [3, Infinity] });

// Who keeps a minimum on a short terminal: the stage and what the task is doing NOW first (1.8.5), then the recent lines.
export const PRIORITY = Object.freeze(["stage", "activity", "recent", "engineer", "verify", "workflow", "improvement", "sandbox", "qa", "notices"]);

// Extra rows, once every section has its minimum, go in this order; RECENT is last because it takes the rest.
const EXTRA = Object.freeze(["stage", "activity", "engineer", "verify", "workflow", "improvement", "sandbox", "qa", "notices", "recent"]);

// A section with gaps between sections needs this many RECENT rows to be worth it.
const ROOMY = 8;

const wantOf = (s) => (s.head ? 1 : 0) + s.rows.length;
const minOf = (s) => Math.min(ROOM[s.name][0], wantOf(s));
const capOf = (s) => Math.min(ROOM[s.name][1], wantOf(s));
const sum = (list, f) => list.reduce((n, s) => n + f(s), 0);
const rank = (order) => (a, b) => order.indexOf(a.name) - order.indexOf(b.name);

function fitting(sections, height) {
  const kept = [...sections].sort(rank(PRIORITY));
  while (kept.length > 1 && sum(kept, minOf) > height) kept.pop();
  return sections.filter((s) => kept.includes(s));
}

function allotted(kept, room) {
  const give = new Map(kept.map((s) => [s.name, minOf(s)]));
  const left = { n: room - sum(kept, minOf) };
  for (const s of [...kept].sort(rank(EXTRA))) left.n -= grown(give, s, left.n);
  return give;
}

function grown(give, s, left) {
  const more = Math.max(0, Math.min(left, capOf(s) - give.get(s.name)));
  give.set(s.name, give.get(s.name) + more);
  return more;
}

const roomy = (kept, height) => sum(kept, (s) => (s.name === "recent" ? Math.min(ROOMY, wantOf(s)) : capOf(s))) + kept.length - 1 <= height;

// Which sections are drawn, how many rows each gets, and whether a blank row separates them.
export function budgetOf(sections, height) {
  const kept = fitting(sections, height);
  const gaps = kept.length > 1 && roomy(kept, height);
  return { sections: kept, rows: allotted(kept, height - (gaps ? kept.length - 1 : 0)), gaps };
}
