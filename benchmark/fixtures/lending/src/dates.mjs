// DAYS. A loan goes out, falls due and comes back on a calendar day, never at a time of day, so every date here is an
// ISO day (YYYY-MM-DD) read in UTC: the same day wherever the service runs.
const DAY_MS = 86400000;

const SHAPE = /^\d{4}-\d{2}-\d{2}$/;

const msOf = (day) => Date.parse(`${day}T00:00:00Z`);

const dayAt = (ms) => new Date(ms).toISOString().slice(0, 10);

// A real day of the calendar: 2026-02-30 is not one.
export const isDay = (v) => typeof v === "string" && SHAPE.test(v) && Number.isFinite(msOf(v)) && dayAt(msOf(v)) === v;

export const addDays = (day, n) => dayAt(msOf(day) + n * DAY_MS);

// Whole days from one day to another: 0 for the same day, negative when `to` comes first.
export const daysBetween = (from, to) => Math.round((msOf(to) - msOf(from)) / DAY_MS);
