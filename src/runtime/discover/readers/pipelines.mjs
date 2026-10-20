// A pipeline definition, read for ONE thing: which operating systems it says the
// project runs on.
//
// That is evidence of where the project is KNOWN to run, and never of where it
// cannot: a pipeline that tests on Linux does not say nothing else works, so the
// constraint it states is not exclusive. A runner label that names no platform
// (`self-hosted`, an expression nobody evaluated) is said, not guessed at, and a
// matrix expression is followed to the list it names when the file gives one.
//
// Which files are pipelines, and which runner labels mean which platform, is
// catalog data (catalog/runtimes.json `ci`): nothing here names a CI product.
import { pipelineFile, platformOfRunner } from "../../catalog.mjs";
import { parseYaml } from "../yaml-lite.mjs";
import { merged } from "./merge.mjs";

export const pipelinesReader = {
  name: "pipelines",
  claims: (path, input) => pipelineFile(input.catalog, path),
  read: (input) => merged(input.paths.map((path) => onePipeline(input, path))),
};

function onePipeline(input, path) {
  const text = input.read(path);
  return text === null ? { observations: [], unknowns: [] } : pipelineFrom(input, path, parseYaml(text));
}

function pipelineFrom(input, path, doc) {
  const labels = jobsOf(doc.value).flatMap(labelsOf);
  const platforms = [...new Set(labels.map((l) => platformOfRunner(input.catalog, l)).filter(Boolean))].sort();
  return { observations: platforms.length ? [{ type: "os", dir: null, path, source: "ci", confidence: "possible", os: platforms, exclusive: false }] : [], unknowns: [...doc.notes.map((n) => `${path}: ${n}`), ...unread(path, labels, input)] };
}

const jobsOf = (doc) => (doc?.jobs && typeof doc.jobs === "object" ? Object.values(doc.jobs).filter((j) => j && typeof j === "object") : []);

// What a job runs on, as labels: a string, a list, or a group with labels; and a
// `${{ matrix.x }}` expression replaced by the list the job's own matrix gives.
function labelsOf(job) {
  const on = job["runs-on"];
  const raw = Array.isArray(on) ? on : on && typeof on === "object" ? [...(on.labels ?? [])] : [on];
  return raw.filter((l) => typeof l === "string").flatMap((l) => matrixed(l, job));
}

function matrixed(label, job) {
  const m = /^\$\{\{\s*matrix\.([A-Za-z0-9_-]+)\s*\}\}$/.exec(label.trim());
  if (!m) return [label];
  const values = job.strategy?.matrix?.[m[1]];
  return Array.isArray(values) ? values.filter((v) => typeof v === "string") : [label];
}

function unread(path, labels, input) {
  const none = [...new Set(labels.filter((l) => !platformOfRunner(input.catalog, l)))];
  return none.length ? [`${path}: ${none.length} runner label(s) name no platform this reads (${none.slice(0, 3).join(", ")})`] : [];
}
