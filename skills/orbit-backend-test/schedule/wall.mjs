// Wall-clock arithmetic. A LOCAL time is held as a "wall": the number Date.UTC gives its fields.
// Ordering, day steps and calendar months then need no zone at all. A wall is never an instant;
// zone.mjs is the only door between the two.
export const SECOND = 1000;
export const MINUTE = 60 * SECOND;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

export const wallOf = (f) => Date.UTC(f.year, f.month - 1, f.day, f.hour ?? 0, f.minute ?? 0, f.second ?? 0);

export function fieldsOf(wall) {
  const d = new Date(wall);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(), hour: d.getUTCHours(), minute: d.getUTCMinutes(), second: d.getUTCSeconds(), weekday: d.getUTCDay() };
}

export const floorTo = (ms, unit) => ms - (((ms % unit) + unit) % unit);
export const dayOf = (wall) => floorTo(wall, DAY);
export const pad = (n, width = 2) => String(n).padStart(width, "0");

export function localText(wall) {
  const f = fieldsOf(wall);
  return `${pad(f.year, 4)}-${pad(f.month)}-${pad(f.day)}T${pad(f.hour)}:${pad(f.minute)}:${pad(f.second)}`;
}

const daysIn = (year, month) => new Date(Date.UTC(year, month, 0)).getUTCDate();

// Calendar months from a wall, clamped to the month's last day (Jan 31 + 1 month is Feb 28 or 29).
// A series counts every step from the same base, so it never drifts: Jan 31, Feb 28, Mar 31.
export function addMonths(wall, months) {
  const f = fieldsOf(wall);
  const total = f.year * 12 + f.month - 1 + months;
  const year = Math.floor(total / 12);
  const month = total - year * 12 + 1;
  return wallOf({ ...f, year, month, day: Math.min(f.day, daysIn(year, month)) });
}
