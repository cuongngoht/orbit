// Security catalogs in Orbit Control, READ (ADR 0040): what Orbit ships, what a person adopted on
// this machine and anything refused with why, and -- for the checkout Control was started from --
// which catalogs the project is held to, which controls a person marked not applicable, and the
// revisions a change must name. One catalog's document, by its digest, for the page to show and mark
// its controls. Reading starts nothing and writes nothing.
import { SECURITY_COMMANDS } from "../core.mjs";
import { guarded, missing } from "../errors.mjs";
import { securityWorld, stateHere } from "./project.mjs";

const DIGEST = /^[0-9a-f]{64}$/;

export const securityCatalogs = (ctx) => guarded("SECURITY_UNAVAILABLE", () => overview(securityWorld(ctx)));

const overview = (w) => ({ available: true, checkout: w.project ? { name: w.project.name } : null, ...SECURITY_COMMANDS.catalogs.run(w.ports) });

export function securityCatalog(ctx, digest) {
  const found = DIGEST.test(String(digest)) ? stateHere(securityWorld(ctx)).layers.catalogs.find((c) => c.digest === digest) : null;
  if (!found) throw missing("SECURITY_CATALOG_UNKNOWN", "no catalog with that digest is shipped or adopted on this machine");
  return { catalog: found.catalog, version: found.version, digest: found.digest, layer: found.layer, document: found.doc };
}
