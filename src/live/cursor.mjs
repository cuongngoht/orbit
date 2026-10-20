// The ONE cursor of a live task: how far a viewer has read each source it is shown. It is the SSE `id` of
// every event Control sends, so a browser that reconnects hands it back as Last-Event-ID; it is the
// `?since=` of the plain read and the `--since=` of a terminal viewer, so polling, streaming and a terminal
// resume from the same place.
//
//   t=<n>(;<inv-id>=<n>)*      the next task line, and the next line of each investigation
//   o=<n>                       a log: the byte offset of the next line
//
// `n` is the NEXT index the viewer has not seen. Anything that is not this grammar starts from zero: a
// viewer dedupes what it already holds, so a bad cursor costs a replay and never a skipped line.
export const CURSOR = /^t=\d{1,9}(;inv-[0-9]{8}-[0-9]{6}-[0-9a-f]{4}=\d{1,9})*$/;
export const MAX_CURSOR = 2048;

const OFFSET = /^(o=)?(\d{1,12})$/;

export const zeroCursor = () => ({ task: 0, inv: new Map() });

export function parseCursor(text) {
  const raw = String(text ?? "");
  if (raw.length > MAX_CURSOR || !CURSOR.test(raw)) return zeroCursor();
  const [task, ...rest] = raw.split(";");
  return { task: Number(task.slice(2)), inv: new Map(rest.map((part) => part.split("=")).map(([id, n]) => [id, Number(n)])) };
}

export const formatCursor = (c) => [`t=${c.task}`, ...[...c.inv].map(([id, n]) => `${id}=${n}`)].join(";");

export const parseOffset = (text) => ((m) => (m ? Number(m[2]) : 0))(OFFSET.exec(String(text ?? "")));

export const formatOffset = (n) => `o=${n}`;
