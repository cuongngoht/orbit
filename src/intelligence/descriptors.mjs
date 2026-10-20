// A PROJECT's own technology descriptors -- the internal SDK, the company
// package nobody else has heard of -- as DATA in the store room, registered
// after everything this engine ships.
//
// Data, never code: recognising a package name needs a row, and a module that
// could run would be a far wider door than a name needs. One file holds one
// descriptor or a list of them. Nothing here throws: a file that is not JSON,
// or a descriptor the contract refuses -- including one reusing a built-in id,
// which would be two meanings for one technology -- is recorded with its reason
// and the rest load, the way src/extensions/loader.mjs treats an extension.
export function loadProjectDescriptors(intel, registry) {
  const results = intel.descriptorFiles().map((file) => oneFile(file, registry));
  return { room: intel.paths.descriptors, loaded: results.flatMap((r) => r.loaded), refused: results.flatMap((r) => r.refused) };
}

function oneFile(file, registry) {
  const json = parsed(file.text);
  if (json === null) return { loaded: [], refused: [{ id: file.name, from: file.name, why: `${file.name} is not valid JSON — nothing in it was registered` }] };
  return registry.descriptors.offer(Array.isArray(json) ? json : [json], `project descriptor ${file.name}`);
}

function parsed(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
