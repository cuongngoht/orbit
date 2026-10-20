// Which rows of the screen changed. The terminal adapter rewrites only those (a position, clear the row, the
// row), so a quiet task costs nothing and a new line costs the rows it moved. Every row is sent on the first
// frame, when the size changed, and when the frame asks for a full redraw (an overlay opened or closed, `r`).
export function changedRows(prev, next) {
  const full = !prev || prev.columns !== next.columns || prev.rows !== next.rows || next.full;
  return next.lines.map((text, row) => ({ row, text })).filter((x) => full || prev.lines[x.row] !== x.text);
}
