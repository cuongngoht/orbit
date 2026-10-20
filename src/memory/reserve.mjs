// Reserve before a browser call. An active marker is never aged out: a slow
// run is still a run, and an interrupted run needs a fresh output directory.
import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { Blocked, Refused } from "../errors.mjs";

export const ACTIVE = ".active";

export function reserveEvidence(dir, explicit = false) {
  try { return reserved(dir, explicit); }
  catch (e) {
    if (e instanceof Refused || e instanceof Blocked) throw e;
    throw new Blocked(`cannot reserve evidence at ${dir}: ${e.message}; use a fresh directory or try again`);
  }
}

function reserved(dir, explicit) {
  mkdirSync(dirname(dir), { recursive: true });
  if (!explicit || !existsSync(dir)) mkdirSync(dir);
  mkdirSync(join(dir, ACTIVE));
  return checked(dir, explicit);
}

function checked(dir, explicit) {
  if (explicit && readdirSync(dir).some((name) => name !== ACTIVE)) return occupied(dir);
  return () => rmSync(join(dir, ACTIVE), { recursive: true, force: true });
}

function occupied(dir) {
  rmSync(join(dir, ACTIVE), { recursive: true, force: true });
  throw new Refused(`--out ${dir} is not empty — use a fresh directory; existing evidence is never overwritten`);
}
