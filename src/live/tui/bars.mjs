// A BAR is drawn only over a count and is always followed by the count it draws, so the picture says what it
// stands on: steps done of the plan's steps, stages seen of twelve, bytes read of the log's size. There is no
// bar over time: nothing a journal holds says how long anything will take, and a viewer never guesses.
//
//   bar(done, total, width) -> string | null       null when the total is not known
//   bytesOf(n) -> "1.2 MB"                          a size as a person reads it
//   counted(done, total, unit) -> "3/7 steps"
const FULL = "▓";
const EMPTY = "░";

const known = (n) => typeof n === "number" && Number.isFinite(n) && n >= 0;

export function bar(done, total, width) {
  if (!known(done) || !known(total) || total === 0 || width < 1) return null;
  const filled = Math.round((Math.min(done, total) / total) * width);
  return `${FULL.repeat(filled)}${EMPTY.repeat(width - filled)}`;
}

export const counted = (done, total, unit) => `${known(done) ? done : "?"}/${known(total) ? total : "?"} ${unit}`;

const UNITS = [[1024 * 1024 * 1024, "GB"], [1024 * 1024, "MB"], [1024, "KB"]];

export function bytesOf(n) {
  if (!known(n)) return "?";
  const unit = UNITS.find(([size]) => n >= size);
  return unit ? `${(n / unit[0]).toFixed(1)} ${unit[1]}` : `${n} B`;
}
