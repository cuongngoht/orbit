// Pipe-separated rows under a dashed separator, as the project's SQL command
// prints them:
//
//     TotalRows          Id|Name
//     ---------          --|----
//     8156               8549|THING-24753
//
// The anchor is the DASHED LINE, never the pipe: a one-column result has no
// pipe anywhere, and anchoring on `includes("|")` returned zero rows for every
// single-column query while reporting success -- an empty parse that looked
// exactly like an empty database. Every value is a STRING; coercing here would
// invent types the query never promised.
//
// The dashes may be joined by `|` or by `+`, and the count that closes the rows
// may say `affected` or not: the same table, as the two common SQL command lines
// draw it (`----+----` and `(1 row)` is how psql does). A count is the END of the
// rows, never one of them.
const SEPARATOR = /^-+([|+]-+)*$/;
const ROWS_AFFECTED = /^\(\d+ rows?(?: affected)?\)$/;

export function parseRows(out) {
  const lines = out.split("\n").map((l) => l.trimEnd());
  const sep = lines.findIndex((l) => SEPARATOR.test(l.trim()));
  if (sep < 1) return [];
  return rowsAfter(lines, sep, lines[sep - 1].split("|").map((s) => s.trim()));
}

function rowsAfter(lines, sep, cols) {
  const rows = [];
  for (const l of lines.slice(sep + 1)) {
    if (!l.trim() || ROWS_AFFECTED.test(l.trim())) break;
    rows.push(rowOf(cols, l));
  }
  return rows;
}

const rowOf = (cols, line) => Object.fromEntries(cols.map((c, i) => [c, line.split("|").map((v) => v.trim())[i]]));
