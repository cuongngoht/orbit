// CREATE: the smallest dev container definition that provides what a checkout
// needs -- and no more.
//
// One file, `devcontainer.json`, built from the normalised requirements: a base
// image the catalog names, one FEATURE for each requirement a catalog feature
// provides, and the ports the components listen on, PUBLISHED (`appPort`: the Dev Containers CLI
// ignores `forwardPorts`, which only an editor forwards). No Dockerfile, no compose
// file, no script and no lifecycle hook: a hook is a command that would run inside
// a container nobody has built yet, and a generated environment is no place to
// invent one. What the catalog cannot provide with a feature is left OUT and said
// -- a proposal that says "this part is yours" is better than one that guesses.
//
// The file is JSONC with a leading comment saying where it came from, and it is
// parsed again before it is returned: a proposal is only as good as the text it
// would write.
import { parse } from "../jsonc.mjs";

export const DEFINITION_PATH = ".devcontainer/devcontainer.json";

const HEADER = "// Created by Orbit from what this checkout's own files say it needs. Review it, and edit it freely.";

const keyOf = (feature) => (feature.tag ? `${feature.id}:${feature.tag}` : feature.id);

// A feature's options: the version when one is known, else the feature's defaults.
const optionsOf = (requirement) => (requirement.wanted ? { [requirement.feature.option]: requirement.wanted } : {});

// -> { path, text } | { problem }
export function create({ requirements, catalog, name }) {
  const providing = requirements.environment.filter((r) => r.feature && r.container !== false);
  if (!catalog.environment.baseImage) return { problem: "the catalog names no base image to build an environment from" };
  if (!providing.length) return { problem: "nothing the checkout needs is something a catalog feature provides, so there is nothing to build an environment from" };
  const body = { name, image: catalog.environment.baseImage, features: Object.fromEntries(providing.map((r) => [keyOf(r.feature), optionsOf(r)])), ...(requirements.ports.length ? { appPort: requirements.ports } : {}) };
  return checked({ path: DEFINITION_PATH, text: `${HEADER}\n${JSON.stringify(body, null, 2)}\n` });
}

// What is written must be what a reader reads back.
const checked = (file) => (parse(file.text).ok ? file : { problem: "the definition that was built does not parse" });

export { keyOf };
