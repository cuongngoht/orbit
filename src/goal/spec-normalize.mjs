import { Refused } from "../errors.mjs";
import { scrub } from "../scrub.mjs";
import { SPEC_MAX_BYTES } from "./vocab.mjs";

export function normalizeSpec(text) {
  const raw = String(text ?? "");
  refuseEmpty(raw);
  refuseLarge(raw);
  return scrubOrRefuse(raw);
}

function refuseEmpty(raw) {
  if (!raw.trim()) throw new Refused("a goal needs a specification — paste it on stdin or use --file");
}

function refuseLarge(raw) {
  if (Buffer.byteLength(raw, "utf8") > SPEC_MAX_BYTES) throw new Refused(`specification exceeds ${SPEC_MAX_BYTES} bytes — split it or trim`);
}

function scrubOrRefuse(raw) {
  const body = scrub(raw);
  if (body !== raw) throw new Refused("specification contains text that cannot be stored safely — remove secrets");
  return body;
}
