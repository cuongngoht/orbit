// Retained command name, explicit explanation instead of writing host memory.
import { Refused } from "../../errors.mjs";

export function projectInto() {
  throw new Refused("host-memory projection is retired; use architecture facts/why and learn recall — SessionStart recalls the Orbit store directly");
}
