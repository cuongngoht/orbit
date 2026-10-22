// Orbit's in-memory filesystem (test/fakes/io.mjs), with ONE difference a real disk has: listing a directory names
// the directories in it as well as the files, as readdirSync does. Satellite's rooms keep a directory per definition
// id and per mission, so its listings need that.
import { fakeIo as orbitFakeIo } from "../../../test/fakes/io.mjs";

const slashed = (path) => String(path).replace(/\\/g, "/");

const childrenOf = (io, p) => [...new Set([...io.files.keys(), ...io.dirs].map(slashed).filter((k) => k.startsWith(`${slashed(p)}/`)).map((k) => k.slice(slashed(p).length + 1).split("/")[0]).filter(Boolean))];

export function fakeIo(opts = {}) {
  const io = orbitFakeIo(opts);
  return Object.assign(io, { list: (p) => childrenOf(io, p) });
}
