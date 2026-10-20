// The SNAPSHOT: one run's collection, frozen -- everything a report computes
// and renders comes from it, and re-rendering reads it again instead of asking
// the source a second time.
//
// Written ONCE: a run whose snapshot exists is refused a second one, so two
// reports cannot disagree about what "that run" collected. Before anything is
// written, every byte is checked for the credential that collected it, in every
// spelling it could travel in -- a collector that echoed an Authorization header
// into a page is a run that stops here, with nothing kept.
//
// Contract orbit.report.snapshot/v1 (skills/orbit-report documents the
// collections): run, project, source, window, calendar, collectedAt,
// completeness, parts, collections.
import { join } from "node:path";
import { Blocked, Refused } from "../errors.mjs";
import { maskValues } from "../scrub.mjs";
import { writeAtomic } from "../store/atomic.mjs";

export const SNAPSHOT_CONTRACT = "orbit.report.snapshot/v1";

// Each collection's container, and the statuses a collector may give one.
export const COLLECTIONS = { repositories: "array", pullRequests: "array", workItems: "array", workItemTypes: "array", iterations: "array", builds: "array", deployments: "array", documents: "object" };
export const STATUSES = ["complete", "partial", "forbidden", "missing", "not-configured"];

const REQUIRED = ["contract", "run", "source", "window", "calendar", "completeness", "collections"];

export function snapshotProblems(s) {
  if (!s || typeof s !== "object") return ["a snapshot is an object"];
  const missing = REQUIRED.filter((k) => s[k] === undefined).map((k) => `no ${k}`);
  if (missing.length) return missing;
  return [...(s.contract === SNAPSHOT_CONTRACT ? [] : [`contract is ${s.contract}, not ${SNAPSHOT_CONTRACT}`]), ...collectionProblems(s.collections), ...completenessProblems(s.completeness)];
}

const collectionProblems = (c) => Object.entries(c ?? {}).filter(([k, v]) => COLLECTIONS[k] && (COLLECTIONS[k] === "array" ? !Array.isArray(v) : typeof v !== "object")).map(([k]) => `collections.${k} must be ${COLLECTIONS[k] === "array" ? "a list" : "an object"}`);

const completenessProblems = (c) => Object.entries(c ?? {}).filter(([, v]) => !STATUSES.includes(v?.status)).map(([k, v]) => `completeness.${k} is "${v?.status}", not one of ${STATUSES.join(", ")}`);

// { room, io, id, snapshot, raw: [page…], secrets: [value…] } -> the file
export function freeze(p) {
  const wrong = snapshotProblems(p.snapshot);
  if (wrong.length) throw new Refused(`the collected snapshot does not hold: ${wrong.join("; ")}`);
  const texts = [JSON.stringify(p.snapshot), ...(p.raw ?? []).map((page) => JSON.stringify(page))];
  clean(texts, p.secrets ?? []);
  return written(p.room.snapshot(p.id), texts, p.io);
}

function clean(texts, secrets) {
  if (texts.some((t) => maskValues(t, secrets) !== t)) throw new Blocked("the collected data carried the credential that collected it, so nothing was frozen — this is a collector defect, and the source was not changed");
}

function written(dir, [snapshot, ...pages], io) {
  if (io.exists(join(dir, "snapshot.json"))) throw new Refused(`${dir} already holds a snapshot; a snapshot is written once`);
  io.ensureDir(join(dir, "raw"));
  pages.forEach((page, i) => io.write(join(dir, "raw", `${String(i + 1).padStart(5, "0")}.json`), page));
  return writeAtomic(join(dir, "snapshot.json"), snapshot, io, false);
}

export function readSnapshot(room, io, id) {
  const text = io.read(join(room.snapshot(id), "snapshot.json"));
  if (!text) throw new Refused(`run ${id} has no snapshot`);
  return JSON.parse(text);
}

export const snapshotFile = (room, id) => join(room.snapshot(id), "snapshot.json");
