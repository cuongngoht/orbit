import { writeSpec } from "./spec.mjs";

export function persistIntake(goals, io, intake) {
  const dir = goals.dirOf(intake.id);
  io.ensureDir(dir);
  goals.begin(intake.id, intake.meta);
  return writeAccepted(goals, io, dir, intake);
}

function writeAccepted(goals, io, dir, intake) {
  goals.append(intake.id, "spec", specLine(intake));
  writeSpec(io, dir, intake.spec);
  return intake.id;
}

function specLine(intake) {
  return { id: intake.id, digest: intake.spec.digest, bytes: intake.spec.bytes, revision: intake.spec.revision, because: "accepted" };
}
