// A mission's GOAL as a person submitted it: scrubbed, bounded, digested and kept once (writePrivate: a goal file is
// never rewritten) in the mission's own room. Orbit's own normalisation is used, so a goal with text that cannot be
// stored safely is refused here exactly as it is for an Orbit goal. Nothing here reads the goal's words: the host's
// model reads them into a structured intent (intent.mjs), in whatever language they were written.
import { join } from "node:path";
import { Refused } from "../../../src/errors.mjs";
import { digestOf, normalizeSpec, titleOf } from "../../../src/goal/spec.mjs";
import { isObject, quietly, refused } from "../store/text.mjs";
import { GOAL_MAX_BYTES } from "./vocab.mjs";

export const GOAL_API = "orbit.satellite.goal/v1";

export const GOAL_FILE = "goal.json";

const FIELDS = ["api", "revision", "digest", "bytes", "body"];

export function goalRecord(text) {
  const raw = String(text ?? "");
  if (Buffer.byteLength(raw, "utf8") > GOAL_MAX_BYTES) throw refused(Refused, "GOAL_TOO_LARGE", `a mission's goal is at most ${GOAL_MAX_BYTES} bytes — put the rest in the files the goal names`);
  const body = normalizeSpec(raw);
  return { api: GOAL_API, revision: 1, digest: digestOf(body), bytes: Buffer.byteLength(body, "utf8"), body };
}

export const writeGoal = (io, dir, record) => io.writePrivate(join(dir, GOAL_FILE), `${JSON.stringify(record, null, 2)}\n`);

const intact = (g) => isObject(g) && g.api === GOAL_API && Object.keys(g).every((k) => FIELDS.includes(k)) && typeof g.body === "string" && g.digest === digestOf(g.body) && g.bytes === Buffer.byteLength(g.body, "utf8");

export function readGoal(io, dir) {
  const g = quietly(() => JSON.parse(io.read(join(dir, GOAL_FILE)) ?? "null"));
  if (!intact(g)) throw refused(Refused, "GOAL_CORRUPT", `${join(dir, GOAL_FILE)} is not the goal this mission was started with; it is kept unchanged`);
  return g;
}

export const objectiveOf = (body) => titleOf(body);

// A reference into the goal a fact may cite: goal@<digest8> or goal@<digest8>#L<n>.
export const GOAL_REF = /^goal@([0-9a-f]{8})(#L[1-9][0-9]{0,5})?$/;
