import { readFileSync } from "node:fs";
import { basename } from "node:path";

// Read each image once; every other section points at the gallery entry.
export function gallery(steps) {
  const files = [...new Set(steps.map((s) => s.screenshot).filter(Boolean))];
  return files.map((file, n) => picture(file, n, steps.filter((s) => s.screenshot === file)));
}

function picture(file, n, steps) {
  const src = embedded(file);
  const caption = `Step ${steps.map((s) => s.i).join(", ")} — ${steps[0].why || "captured screen"}`;
  return { id: `shot-${n + 1}`, file, src, missing: src ? null : basename(file), alt: caption, caption };
}

function embedded(file) {
  try { return image(readFileSync(file)); }
  catch { return null; }
}

function image(bytes) {
  if (!bytes.length) return null;
  return `data:image/png;base64,${bytes.toString("base64")}`;
}

export const shotLink = (s, shots) => shots.find((p) => p.file === s.screenshot)?.id ?? null;
