// A PIN: which task a person wants a viewer of this checkout to show. A viewer's preference, never a fact about
// the task -- it is not a journal line, it moves no revision, and no orchestrator reads it. Kept in the room a
// person's per-checkout runtime facts already use (<storeRoot>/runtime/<machine>/sessions/<checkout>/live/),
// one small file per scope:
//
//   <session-mark>.json   this session's viewers show this task     (a session that knows its mark)
//   checkout.json         every viewer of this checkout shows it    (a person in any terminal)
//
// Written only by a person's `live pin` / `live unpin`; read by every viewer; never written on a read. A pin
// older than a week is pruned the next time one is written, and a pin whose task ended long ago is simply not
// shown (src/live/association.mjs).
import { join } from "node:path";
import { Refused } from "../errors.mjs";
import { readState, writeState } from "../store/control.mjs";

export const PIN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const CHECKOUT_PIN = "checkout";

const TASK_ID = /^tsk-[a-f0-9]{12}$/;
const KEY = /^([a-f0-9]{16}|checkout)$/;

const fileOf = (dir, key) => join(dir, `${key}.json`);

function keyOf(mark) {
  const key = mark ?? CHECKOUT_PIN;
  if (!KEY.test(key)) throw new Refused("a pin is kept for a session mark (sixteen hex characters) or for the checkout");
  return key;
}

const taskIn = (io, file) => ((doc) => (TASK_ID.test(doc.task ?? "") ? doc.task : null))(readState(io, file, {}));

export function readPins(io, dir, mark) {
  const session = mark && KEY.test(mark) ? taskIn(io, fileOf(dir, mark)) : null;
  return { session, checkout: taskIn(io, fileOf(dir, CHECKOUT_PIN)) };
}

export function writePin(io, dir, { mark, task, at, nowMs }) {
  const key = keyOf(mark);
  readied(io, dir, task, nowMs);
  writeState(io, fileOf(dir, key), { task, at, by: "person" });
  return { key, task };
}

function readied(io, dir, task, nowMs) {
  if (!TASK_ID.test(String(task ?? ""))) throw new Refused("a task id is tsk- followed by twelve hex characters");
  io.ensureDir(dir);
  pruned(io, dir, nowMs);
}

export function clearPin(io, dir, mark) {
  const key = keyOf(mark);
  io.removeFile(fileOf(dir, key));
  return { key, task: null };
}

const stale = (io, dir, name, nowMs) => ((doc) => !doc.at || nowMs - Date.parse(doc.at) > PIN_TTL_MS)(readState(io, join(dir, name), {}));

function pruned(io, dir, nowMs) {
  io.list(dir).filter((n) => n.endsWith(".json")).filter((n) => stale(io, dir, n, nowMs)).forEach((n) => io.removeFile(join(dir, n)));
}
