// PINNING what a run executes. Before any part runs, every project extension it
// will use is COPIED -- flat, as bytes -- into the run's own directory and
// hashed there, and the parts run from that copy: an extension re-registered
// while a report runs cannot change the report half way, and the run records
// exactly which files it executed. The standard kit is not copied (it is the
// plugin itself); its digest is taken once and checked before each kit part.
import { createHash } from "node:crypto";
import { join } from "node:path";
import { digestOfAll, filesOf, fingerprintOf, readSidecar } from "../extensions/fingerprint.mjs";

// parts: the candidates · states: { extId: { dir, status } } · into: the stage room
// -> { parts (each with sha256), entryOf, rootsOf, extensions: { id: { digest, files, fingerprint } } }
//
// The fingerprint is judged on the COPY, against what was registered: the
// files that run are the files that were checked, with no moment between the
// check and the copy for either to change.
export function stageParts(parts, states, into, io) {
  const used = [...new Set(parts.filter((p) => p.source === "store" && states[p.from]?.dir).map((p) => p.from))].sort();
  const copies = Object.fromEntries(used.map((id) => [id, copied(states[id].dir, join(into, id), io)]));
  const shaOf = (p) => (p.source === "store" ? copies[p.from]?.files[p.entry.replace(/^\.\//, "")] ?? null : fileSha(p.file, io));
  return { parts: parts.map((p) => ({ ...p, sha256: shaOf(p) })), entryOf: (p) => (p.source === "store" ? join(into, p.from, p.entry.replace(/^\.\//, "")) : p.file), rootsOf: (p) => (p.source === "store" ? [join(into, p.from)] : []), extensions: copies };
}

function copied(from, to, io) {
  io.ensureDir(to);
  for (const name of filesOf(from, io)) io.copy(join(from, name), join(to, name));
  return judged(fingerprintOf(to, io), readSidecar(from, io));
}

function judged(files, sidecar) {
  const same = sidecar?.files && JSON.stringify(sorted(files)) === JSON.stringify(sorted(sidecar.files));
  return { files, digest: digestOfAll(files), fingerprint: !sidecar?.files ? "absent" : same ? "ok" : "changed", registeredBy: sidecar?.by ?? null };
}

const sorted = (o) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));

function fileSha(file, io) {
  const bytes = file ? io.bytes(file) : null;
  return bytes ? createHash("sha256").update(bytes).digest("hex") : null;
}

// The kit's digest: every file of the directories its parts are imported from.
export function kitDigest(kitDir, io, dirs = [".", "orbit_report"]) {
  const all = Object.fromEntries(dirs.flatMap((d) => Object.entries(fingerprintOf(join(kitDir, d), io)).filter(([n]) => n.endsWith(".py")).map(([n, h]) => [`${d}/${n}`, h])));
  return digestOfAll(all);
}
