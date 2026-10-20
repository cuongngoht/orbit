// WHICH investigations were begun against a task's sandbox -- found by reading, never by asking anyone to
// say so. An investigation begun with `--sandbox=<env>` writes the task that owns the sandbox on its
// FIRST line (`created.runtime.task`, src/investigation/index.mjs boundTo); the task itself learns of it
// only when the agent links it after it ended. A live page cannot wait for that, so:
//
//   1. list the investigations room (one listing; ids sort by when they began, newest first);
//   2. keep the ids begun at or after the task's own start (the id carries its own time);
//   3. read the FIRST line of each of those, once ever per id (`known` remembers the answer);
//   4. keep the ones whose first line names this task, newest first, at most MAX_FOLLOWED.
//
// A receipt the task linked (`receipt` with domain investigation) names an id directly; it is `claimed`
// without a listing and still held to its first line. Read-only, and it imports nothing of the task:
// a task id arrives as a string.
export const MAX_FOLLOWED = 20;

// The time part of an id (`inv-YYYYMMDD-HHMMSS-xxxx`), from an ISO instant.
export const stampOf = (iso) => `${iso.slice(0, 10).replaceAll("-", "")}-${iso.slice(11, 19).replaceAll(":", "")}`;

export const begunAfter = (id, stamp) => id.slice(4, 19) >= stamp;

export const belongsTo = (head, task) => head?.kind === "created" && head.runtime?.task === task;

// -> ids, newest first. `known` is a Map the caller keeps across calls: id -> belongs (boolean).
export function investigationsOf(store, { task, since, known = new Map(), claimed = [], limit = MAX_FOLLOWED }) {
  const listed = since ? store.list().filter((id) => begunAfter(id, since)) : [];
  const asked = [...new Set([...claimed.filter((id) => isInvestigationId(store, id)), ...listed])];
  for (const id of asked.filter((x) => !known.has(x))) remembered(known, id, headOf(store, id), task);
  return asked.filter((id) => known.get(id)).sort().reverse().slice(0, limit);
}

// A journal whose first line is not written yet is asked again next time, not judged on nothing.
function remembered(known, id, head, task) {
  if (head) known.set(id, belongsTo(head, task));
}

const ID = /^inv-[0-9]{8}-[0-9]{6}-[0-9a-f]{4}$/;

const isInvestigationId = (store, id) => ID.test(String(id)) && store.exists(id);

function headOf(store, id) {
  try { return store.head(id); }
  catch { return null; }
}
