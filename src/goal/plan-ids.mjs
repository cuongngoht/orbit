import { short } from "../hash.mjs";

export function unitId(seed) {
  return `gu-${short(seed, 8)}`;
}

export function acId(seed) {
  return `ac-${short(seed, 8)}`;
}

export function reqId(seed) {
  return `gr-${short(seed, 8)}`;
}
