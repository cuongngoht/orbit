// WHICH interpreter runs a report's parts, decided in a fixed order, and every
// step's answer kept so a page can say why:
//
//   configured    ORBIT_PYTHON names one -- asked its version like any other,
//                 and refused (with the reason) when it is too old, never
//                 silently replaced by another
//   orbit-managed  the private copy Orbit installed, found from its receipt
//   system        the first interpreter on PATH that is new enough
//
// Nothing here installs anything: a machine without one is told where to get
// one (Orbit Control -> Tools), and the run stops before it collects. The tool
// row comes from the plugin's catalog, and the detection context is the tools
// subsystem's -- this is a view over them, not a second detector.
import { detectTool, finding, sourced } from "../tools/detect.mjs";

// row: the catalog's `python` row · ctx: a tools detection context · configured: a path or null
// -> { file, version, from } or { file: null, reason, sources }
export function resolvePython(row, ctx, configured = null) {
  const found = configured ? finding(row, [sourced("configured", [configured], row, ctx)], ctx) : detectTool(row, ctx);
  if (found.status === "ready") return { file: found.path, version: found.version, from: found.source, sources: found.sources };
  return { file: null, version: null, from: null, reason: configured ? `ORBIT_PYTHON names ${configured}: ${found.reason ?? "it is not there"}` : found.reason ?? `no Python ${row.detection.minimum ?? ""} or newer was found`, sources: found.sources };
}
