// What was REGISTERED, file by file -- so whoever reads an extension later can
// tell the files it finds from the files that were verified.
//
// Registering writes `.registered.json` beside the manifest: the version, and a
// SHA-256 of every file the extension is. A file edited by hand in the store
// afterwards no longer matches, and the reader decides what that costs it: the
// report runner will not run such a part, and activating it is refused. The
// loader itself does not look, so an extension registered before this record
// existed loads exactly as it always did.
//
// The manifest is hashed WITHOUT its `status`: status is the one field the
// lifecycle itself rewrites, and moving a verified extension to active does not
// change what was verified.
import { createHash } from "node:crypto";
import { join } from "node:path";
import { MANIFEST_FILE } from "./contract.mjs";

export const SIDECAR = ".registered.json";

// The files an extension IS: every regular file of its directory whose name
// does not start with a dot. A directory or a link somebody added later is not
// one of them -- it is never copied, so it is never what runs.
export const filesOf = (dir, io) => io.list(dir).filter((n) => !n.startsWith(".") && (io.kind?.(join(dir, n)) ?? "file") === "file").sort();

export const fingerprintOf = (dir, io) => Object.fromEntries(filesOf(dir, io).map((n) => [n, digestOf(dir, n, io)]));

function digestOf(dir, name, io) {
  const bytes = io.bytes(join(dir, name));
  return name === MANIFEST_FILE ? sha256(statusless(bytes)) : sha256(bytes ?? "");
}

const sha256 = (data) => createHash("sha256").update(data).digest("hex");

function statusless(bytes) {
  try { return JSON.stringify({ ...JSON.parse(String(bytes)), status: undefined }); }
  catch { return bytes ?? ""; }
}

// One digest over the whole set, for a directory name or a line in a run.
export const digestOfAll = (files) => sha256(Object.entries(files).map(([n, h]) => `${n}:${h}`).join("\n"));

export const sidecarText = ({ id, version, files, at, by }) => `${JSON.stringify({ id, version, files, digest: digestOfAll(files), at, by }, null, 2)}\n`;

export function readSidecar(dir, io) {
  try { return JSON.parse(io.read(join(dir, SIDECAR)) ?? "null"); }
  catch { return null; }
}

// ok · changed · absent -- and which files differ.
export function registeredState(dir, io) {
  const sidecar = readSidecar(dir, io);
  if (!sidecar?.files) return { state: "absent", changed: [] };
  const now = fingerprintOf(dir, io);
  const changed = [...new Set([...Object.keys(now), ...Object.keys(sidecar.files)])].filter((n) => now[n] !== sidecar.files[n]).sort();
  return { state: changed.length ? "changed" : "ok", changed, version: sidecar.version, digest: sidecar.digest, at: sidecar.at, by: sidecar.by };
}
