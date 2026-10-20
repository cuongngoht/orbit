// Container BUILD and COMPOSE files: what image a thing is built from, which
// ports it says it exposes, and which servers the project is defined with.
//
// Everything a container file declares is a DECLARATION about the container, and
// is held as exactly that. A base image says what a container runs, not what the
// project needs to run on a laptop, so the requirement it implies is `possible`
// and never certain; an `EXPOSE` says where a process in the container listens,
// not that anything does. A service is a server the project is DEFINED with -- a
// database, a cache -- and is recorded as that, identified by the catalog's own
// row when its image is one and by the name the file gave it otherwise. A
// service the compose file only BUILDS (no image) is the project's own code in a
// container, and is not a dependency.
import { posix } from "node:path";
import { instructions, isCompose, isDockerfile, stagesOf } from "../../environment/container-files.mjs";
import { byImage, serviceByImage, tagOf } from "../../catalog.mjs";
import { pinRange } from "../../ranges.mjs";
import { parseYaml } from "../yaml-lite.mjs";
import { merged } from "./merge.mjs";

export const containersReader = {
  name: "container-files",
  claims: (path) => isDockerfile(path) || isCompose(path),
  read: (input) => merged(input.paths.map((path) => (isDockerfile(path) ? build(input, path) : compose(input, path)))),
};

const evidence = { source: "container-file", confidence: "possible" };

// ---- a container build file ----------------------------------------------------------------

function build(input, path) {
  const text = input.read(path);
  if (text === null) return { observations: [], unknowns: [] };
  const stages = stagesOf(text);
  const dir = posix.dirname(path);
  return { observations: [...baseImages(input, path, dir, stages.images), ...exposed(path, dir, text)], unknowns: stages.arguments ? [`${path}: ${stages.arguments} base image(s) are set by a build argument, which is not evaluated`] : [] };
}

function baseImages(input, path, dir, images) {
  return images.flatMap(({ image }) => {
    const row = byImage(input.catalog, image);
    return row ? [{ type: "requirement", dir, path, ...evidence, requirement: row.id, range: pinRange(tagOf(image)), why: `the build starts from ${image}` }] : [];
  });
}

const exposed = (path, dir, text) => instructions(text).filter((l) => /^EXPOSE\s/i.test(l)).flatMap((l) => l.split(/\s+/).slice(1)).map((p) => /^(\d+)(?:\/tcp)?$/i.exec(p)?.[1]).filter(Boolean).map((p) => ({ type: "port", dir, path, ...evidence, port: Number(p) }));

// ---- a compose file ------------------------------------------------------------------------

function compose(input, path) {
  const text = input.read(path);
  if (text === null) return { observations: [], unknowns: [] };
  const doc = parseYaml(text);
  const services = doc.value?.services && typeof doc.value.services === "object" ? Object.entries(doc.value.services) : [];
  return { observations: services.flatMap(([name, svc]) => serviceOf(input, path, name, svc)), unknowns: doc.notes.map((n) => `${path}: ${n}`) };
}

function serviceOf(input, path, name, svc) {
  const image = typeof svc?.image === "string" ? svc.image : null;
  if (!image) return [];
  const row = serviceByImage(input.catalog, image);
  return [{ type: "service", path, source: "container-file", confidence: "certain", service: row?.id ?? name, name, image, port: publishedPort(svc.ports) ?? row?.ports[0] ?? null }];
}

// The HOST port of the first mapping that names one: `8080:80` and
// `127.0.0.1:8080:80` publish 8080; a bare `80` and a range publish none a
// person could rely on.
function publishedPort(ports) {
  const found = (Array.isArray(ports) ? ports : []).map(hostPort).find(Boolean);
  return found ?? null;
}

function hostPort(entry) {
  if (entry && typeof entry === "object") return Number.isInteger(entry.published) ? entry.published : Number(entry.published) || null;
  const parts = String(entry).split(":");
  return parts.length >= 2 && /^\d+$/.test(parts.at(-2)) ? Number(parts.at(-2)) : null;
}
