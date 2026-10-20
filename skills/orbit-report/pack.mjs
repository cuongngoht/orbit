// The project-report PACK, bound once by a composition root
// (cli/project-report.mjs, cli/qc-tool.mjs, Orbit Control): the standard parts,
// the providers a connection can be, the kit the Python parts run from, the
// template and the vendored assets, and the source adapters.
//
// Product words live HERE and in the data beside this file -- which providers
// exist, what a token looks like, which permissions to ask for -- so nothing
// under src/ has to know any of them.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const PACK_ROOT = dirname(fileURLToPath(import.meta.url));
const at = (...p) => join(PACK_ROOT, ...p);
const json = (file) => JSON.parse(readFileSync(at(file), "utf8"));

export const KIT_DIR = at("python");
export const SHIM = at("python", "orbit_part.py");

const FONTS = [
  { family: "IBM Plex Sans", weight: 400, file: "plex/IBMPlexSans-Regular.woff2" },
  { family: "IBM Plex Sans", weight: 500, file: "plex/IBMPlexSans-Medium.woff2" },
  { family: "IBM Plex Sans", weight: 600, file: "plex/IBMPlexSans-SemiBold.woff2" },
  { family: "IBM Plex Mono", weight: 400, file: "plex/IBMPlexMono-Regular.woff2" },
  { family: "IBM Plex Mono", weight: 500, file: "plex/IBMPlexMono-Medium.woff2" },
];

// Built-in parts, with the file each one IS resolved inside the pack.
export function standardParts() {
  const table = json("parts.json");
  return table.parts.map((p) => ({ ...p, source: "builtin", from: "orbit", file: at(p.entry.replace(/^\.\//, "")) }));
}

export const standardSections = () => json("parts.json").sections;

export const providers = () => json("providers.json").providers;

export function renderAssets() {
  return { template: readFileSync(at("assets", "report_template.html"), "utf8"), chartjs: readFileSync(at("assets", "vendor", "chart.umd.min.js"), "utf8"), fonts: FONTS.map((f) => ({ ...f, bytes: readFileSync(at("assets", "vendor", f.file)) })) };
}

export const vendorManifest = () => json(join("assets", "vendor", "VENDOR.json"));

export const kitVersion = () => json("parts.json").parts.find((p) => p.id === "orbit.report.metrics").version;
