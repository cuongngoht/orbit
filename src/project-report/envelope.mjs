// What a report PART is handed on stdin -- contract orbit.report.part/v1 -- and
// nothing more. The shape is the whole list of what a part may know:
//
//   part      its own row: id, kind, version, the file that is it, the metrics
//             it declared (so it can only record those)
//   run       the run id, the window, the calendar, the forecast seed
//   inputs    PATHS to read: the frozen snapshot, earlier parts' outputs, a
//             prepared directory -- never a URL, never a connection
//   output    the one directory it may write in
//   settings  the project's mapping and assumptions, and its own config
//
// There is no credential field, and `envelopeFor` refuses to build one that
// carries a key named like one: a part that computes or renders has no use for
// a credential, and handing one over is how it would end up in a report.

export const PART_CONTRACT = "orbit.report.part/v1";

export function envelopeFor({ part, entry, runId, window, calendar, seed, inputs = {}, outputDir, settings = {} }) {
  const envelope = { contract: PART_CONTRACT, part: partOf(part, entry), mode: "run", run: { id: runId, window, calendar, seed }, inputs, output: { dir: outputDir }, settings };
  const leaked = keysNamedLikeSecrets(envelope.settings);
  if (leaked.length) throw new TypeError(`a report part's envelope may not carry ${leaked.join(", ")}: no part is ever handed a credential`);
  return envelope;
}

const partOf = (part, entry) => ({ id: part.id, kind: part.kind, version: part.version, entry, metrics: part.metrics ?? [], section: part.section ?? null, formats: part.formats ?? [] });

function keysNamedLikeSecrets(value, path = "settings") {
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([k, v]) => (secretNamed(k) ? [`${path}.${k}`] : keysNamedLikeSecrets(v, `${path}.${k}`)));
}

// A key is read as its WORDS -- `githubToken`, `ado_pat`, `API-Key` -- so a
// camelCase name cannot slip past a word list that expects separators.
const SECRET_WORDS = new Set(["token", "secret", "password", "pwd", "pat", "credential", "credentials", "authorization", "bearer", "apikey"]);

function secretNamed(key) {
  const words = String(key).replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  return words.some((w, i) => SECRET_WORDS.has(w) || (w === "api" && words[i + 1] === "key"));
}

// The seed a run's forecast draws from: fixed per run, so a re-render of the
// same snapshot reproduces the same numbers, and recorded in the report.
export function seedOf(runId) {
  let h = 2166136261;
  for (const ch of String(runId)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return h;
}
