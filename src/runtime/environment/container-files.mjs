// Container BUILD and COMPOSE files, as far as the runtime subject reads them: which
// paths are one, and which base images a build file's stages start from.
//
// Shared by both halves that need it -- discovery reads the committed files as
// evidence (src/runtime/discover/readers/containers.mjs) and the designer reads the
// ones a dev container definition points at, on the disk now -- so a Windows base
// image is found the same way by both.
import { posix } from "node:path";

const DOCKERFILE = /^(Dockerfile(\..+)?|.+\.dockerfile)$/i;
const COMPOSE = /^(docker-)?compose(\..+)?\.ya?ml$/i;

export const isDockerfile = (path) => DOCKERFILE.test(posix.basename(path));

export const isCompose = (path) => COMPOSE.test(posix.basename(path));

// A continued line is one line. -> [instruction line]
export const instructions = (text) => String(text).replace(/\\\r?\n/g, " ").split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));

// The images a file's stages start from, with stage aliases and build-argument
// images set apart: an alias is not an image, and a `$` is a value nobody
// evaluated.
export function stagesOf(text) {
  const aliases = new Set();
  const from = [];
  for (const line of instructions(text)) record(line, aliases, from);
  return { images: from.filter((f) => f.image && !f.argument), arguments: from.filter((f) => f.argument).length };
}

function record(line, aliases, from) {
  const m = /^FROM\s+(?:--\S+\s+)*(\S+)(?:\s+AS\s+(\S+))?/i.exec(line);
  if (!m) return;
  if (m[2]) aliases.add(m[2].toLowerCase());
  from.push({ image: aliases.has(m[1].toLowerCase()) && m[2] === undefined ? null : m[1], argument: m[1].includes("$") });
}
