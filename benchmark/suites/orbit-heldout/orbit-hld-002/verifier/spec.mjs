// THE HIDDEN CHECKS of ORBIT-HLD-002: a copy that comes back serves the members waiting for its title, first come,
// first served -- held to a reference model written from the goal, never from the fixture's code. Each check lends one
// or two copies of a title, has members place holds on it (or on another title) in an order, brings the copies back one
// day apart -- at the desk or through the drop box -- and then has a member with no hold, and the one first in line,
// try to borrow the first copy. The probe reads back every copy, hold and notice; a group judges only the facts its
// sentence is about.
//
//   GROUPS · cases(seed, samples) -> [{ id, group, input, expect }] · selfTest() -> [] when the model holds · servedOf(input)
export const GROUPS = {
  "first-come": "A copy that comes back is set aside for the member whose hold on its title was placed first and is still waiting; every other hold keeps waiting, and a hold on another title is never served by it.",
  pickup: "The hold that is served is `ready`, names the copy, and gives until seven days after the day the copy came back to collect it (`pickupBy`); its member is sent one `hold-ready` notice saying the same, and nobody else is sent one.",
  "set-aside": "A copy set aside is `held`: anyone else who asks to borrow it is refused, 409 `held-for-another`, and when the member it is set aside for borrows it, their hold is `collected`.",
  "nobody-waiting": "With nobody waiting for its title -- no hold, or holds on other titles only -- a copy that comes back goes back on the shelf, anyone may borrow it, and no notice is sent.",
  dropbox: "A copy that comes back through the drop box serves the holds exactly as one checked in at the desk.",
};

// ---- the goal's rule, as a model -----------------------------------------------------------------------------------

const DAY_MS = 86400000;

const addDays = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);

const PICKUP_DAYS = 7;

const sameOf = (input) => input.holds.map((on, j) => (on === "same" ? j : -1)).filter((j) => j >= 0);

// Which hold each returning copy is set aside for, in the order the copies come back: the next one first in line.
export const servedOf = (input) => Array.from({ length: input.returns }, (_, i) => sameOf(input)[i]);

const stateOf = (input, j) => (servedOf(input).includes(j) ? "ready" : "waiting");

const pickupOf = (input, i) => addDays(input.out, input.back + i + PICKUP_DAYS);

const servedPairs = (input) => servedOf(input).map((j, i) => [j, i]).filter(([j]) => j !== undefined);

const firstCome = (input) => [...input.holds.map((_, j) => `hold:${j}:${stateOf(input, j)}`), ...servedPairs(input).map(([j, i]) => `ready-copy:${j}:${i}`)];

const pickedUp = (input) => [...servedPairs(input).flatMap(([j, i]) => [`pickup:${j}:${pickupOf(input, i)}`, `notice:${j}:hold-ready:${j}:${i}:${pickupOf(input, i)}`]), `notices:${servedPairs(input).length}`];

const EXPECT = {
  "first-come": (input) => ({ has: firstCome(input) }),
  pickup: (input) => ({ has: pickedUp(input) }),
  "set-aside": (input) => ({ has: ["copy:0:held", "borrow-other:409:held-for-another", "borrow-holder:201", `after:${servedOf(input)[0]}:collected`] }),
  "nobody-waiting": (input) => ({ has: [...Array.from({ length: input.returns }, (_, i) => `copy:${i}:shelf`), "notices:0", "borrow-other:201"] }),
  dropbox: (input) => ({ has: [...firstCome(input), ...pickedUp(input)] }),
};

// ---- seeded inputs ------------------------------------------------------------------------------------------------

const streamOf = (seed) => ((st) => () => ((st.s = (st.s * 1664525 + 1013904223) % 4294967296), st.s / 4294967296))({ s: seed >>> 0 || 1 });

const pick = (next, xs) => xs[Math.floor(next() * xs.length)];

const between = (next, lo, hi) => lo + Math.floor(next() * (hi - lo + 1));

const OUT_DAYS = ["2026-03-02", "2026-02-20", "2028-02-15", "2026-12-20", "2027-06-25"];

// Holds in an order, at least one on the title that comes back unless `none` asks for none.
const holdsOf = (next, none) => ((xs) => (none || xs.includes("same") ? xs : [...xs, "same"]))(Array.from({ length: between(next, none ? 0 : 1, 4) }, () => (none ? "other" : pick(next, ["same", "same", "other"]))));

// The member who tries to borrow the first copy after somebody with no hold: whoever its hold was set aside for.
const withCollector = (input) => ({ ...input, collector: servedOf(input)[0] ?? null });

const inputOf = (next, o) => withCollector({ out: pick(next, OUT_DAYS), back: between(next, 0, 30), via: o.via ?? pick(next, ["desk", "dropbox"]), format: pick(next, ["book", "dvd"]), holds: holdsOf(next, o.none === true), returns: o.returns ?? between(next, 1, 2) });

const GENERATORS = {
  "first-come": (next) => inputOf(next, { via: "desk" }),
  pickup: (next) => inputOf(next, { via: "desk" }),
  "set-aside": (next) => inputOf(next, { returns: 1 }),
  "nobody-waiting": (next) => inputOf(next, { none: true }),
  dropbox: (next) => inputOf(next, { via: "dropbox" }),
};

const ORDER = Object.keys(GROUPS);

const fixed = (id, group, o) => ({ id, group, input: withCollector({ out: "2026-03-02", back: 5, via: "desk", format: "book", returns: 1, ...o }) });

// The boundaries every run holds, whatever its seed.
const FIXED = [
  fixed("first-come-two-waiting", "first-come", { holds: ["same", "same"] }),
  fixed("first-come-other-title-first", "first-come", { holds: ["other", "same", "same"] }),
  fixed("first-come-two-copies", "first-come", { holds: ["same", "same", "same"], returns: 2 }),
  fixed("pickup-end-of-february", "pickup", { out: "2026-02-20", back: 8, holds: ["same"] }),
  fixed("pickup-end-of-year", "pickup", { out: "2026-12-20", back: 6, format: "dvd", holds: ["same", "same"], returns: 2 }),
  fixed("set-aside-one-waiting", "set-aside", { holds: ["same"] }),
  fixed("set-aside-behind-another-title", "set-aside", { holds: ["other", "same"], via: "dropbox" }),
  fixed("nobody-waiting-at-all", "nobody-waiting", { holds: [] }),
  fixed("nobody-waiting-other-titles", "nobody-waiting", { holds: ["other", "other"], returns: 2 }),
  fixed("dropbox-two-waiting", "dropbox", { holds: ["same", "same"], via: "dropbox" }),
];

const seeded = (seed, samples) => ((next) => Array.from({ length: samples }, (_, i) => ((group) => ({ id: `${group}-${i}`, group, input: GENERATORS[group](next) }))(ORDER[i % ORDER.length])))(streamOf(seed));

export const cases = (seed, samples) => [...FIXED, ...seeded(seed, samples)].map((c) => ({ ...c, expect: EXPECT[c.group](c.input) }));

// ---- the model, held to a table written by hand ----------------------------------------------------------------------

const TABLE = [
  [{ holds: ["same", "same"], returns: 1 }, [0]],
  [{ holds: ["other", "same", "same"], returns: 1 }, [1]],
  [{ holds: ["same", "same", "same"], returns: 2 }, [0, 1]],
  [{ holds: ["other", "other"], returns: 2 }, [undefined, undefined]],
  [{ holds: ["same"], returns: 2 }, [0, undefined]],
  [{ holds: [], returns: 1 }, [undefined]],
];

const tableFindings = () => TABLE.filter(([input, want]) => JSON.stringify(servedOf(input)) !== JSON.stringify(want)).map(([input, want]) => `${JSON.stringify(input)} serves ${JSON.stringify(servedOf(input))}, and the goal says ${JSON.stringify(want)}`);

const dayFindings = () => (pickupOf({ out: "2026-02-20", back: 8 }, 0) === "2026-03-07" && pickupOf({ out: "2026-12-20", back: 6 }, 1) === "2027-01-03" ? [] : ["a week to collect is not counted in days of the calendar"]);

export const selfTest = () => [...tableFindings(), ...dayFindings()];
