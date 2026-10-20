// An EXISTING dev container definition, read as evidence -- never as proof that
// the environment it describes still matches what the project needs.
//
// What is kept is a summary of what the definition PROVIDES (src/runtime/
// environment/devcontainer.mjs): its image, its features, the ports it forwards,
// which lifecycle hooks it has and which environment variables it names. What it
// RUNS is never kept, and never run: a hook is a command that would execute
// inside a container nobody has been asked about, and reading a file is not
// permission to do that.
//
// The images a definition builds from are followed one step -- a referenced
// build file's base images are read into the summary -- because whether the
// environment is one a local container runtime can start depends on them (a
// Windows image cannot be started where Linux containers are what there is).
import { isDefinition, references, summarize } from "../../environment/devcontainer.mjs";
import { parse } from "../../jsonc.mjs";
import { isDockerfile, stagesOf } from "../../environment/container-files.mjs";
import { merged } from "./merge.mjs";

export const definitionsReader = {
  name: "environment-definitions",
  claims: (path) => isDefinition(path),
  read: (input) => merged(input.paths.map((path) => oneDefinition(input, path))),
};

function oneDefinition(input, path) {
  const text = input.read(path);
  return text === null ? { observations: [], unknowns: [] } : definitionFrom(input, path, parse(text));
}

function definitionFrom(input, path, doc) {
  if (!doc.ok) return failed(`${path}: it does not parse (${doc.error})`);
  const summary = summarize(doc.value);
  return summary ? { observations: [definitionOf(input, path, summary)], unknowns: [] } : failed(`${path}: it is not a JSON object`);
}

const failed = (say) => ({ observations: [], unknowns: [say], gaps: [say] });

function definitionOf(input, path, summary) {
  const refs = references(path, summary).filter((p) => input.has(p));
  const images = [summary.image, ...refs.filter(isDockerfile).flatMap((p) => stagesOf(input.read(p) ?? "").images.map((s) => s.image))].filter(Boolean);
  return { type: "definition", path, mechanism: "devcontainer", scope: [path, ...refs], source: "container-file", confidence: "certain", definition: { ...summary, references: refs, images } };
}
