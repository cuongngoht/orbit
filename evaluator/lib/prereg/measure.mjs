// HOW BIG AN INSTANCE IMAGE IS, before it is pulled: the sum of its layers' compressed sizes, from the registry's
// manifest (`docker manifest inspect -v`). One instance of every repository is measured to decide which repositories fit
// the disk; the top of each ordered list is measured to pass over an instance whose own image is too big.
//
//   compressedBytes(ref) -> number | null
import { docker } from "../core/docker.mjs";

const manifestOf = (out) => ((d) => (Array.isArray(d) ? d[0] : d))(JSON.parse(out));

export function compressedBytes(ref) {
  const r = docker(["manifest", "inspect", "-v", ref], { timeoutMs: 60000 });
  if (!r.ok) return null;
  const m = manifestOf(r.out);
  const layers = (m.OCIManifest ?? m.SchemaV2Manifest)?.layers ?? [];
  return layers.length ? layers.reduce((s, l) => s + l.size, 0) : null;
}
