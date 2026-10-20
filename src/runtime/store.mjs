// The UNDERSTANDING of one checkout inside the machine store: one file per fact,
// a state file beside them, and what the store noticed.
//
// How a room of facts is kept is src/store/fact-room.mjs, the same implementation
// architecture's facts use. What is specific here is only where the room is --
// one per CHECKOUT (src/runtime/rooms.mjs) -- and what a usable state file looks
// like (src/runtime/model.mjs).
import { join } from "node:path";
import { createFactRoom } from "../store/fact-room.mjs";
import { emptyModel, usableModel } from "./model.mjs";

export const DIR = "understanding";

// `room` is the checkout's room (src/runtime/rooms.mjs `understandingRoom`).
export const runtimePaths = (room) => ({
  root: room,
  facts: join(room, "facts"),
  state: join(room, "state"),
  model: join(room, "state", "model.json"),
  findings: join(room, "state", "findings"),
});

export function createRuntimeStore(room, io) {
  const paths = runtimePaths(room);
  return { room, ...createFactRoom({ paths, io, empty: emptyModel, usable: usableModel }) };
}
