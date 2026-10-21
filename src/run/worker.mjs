// A run INSIDE an isolated worker (ADR 0038): what the request says, how its refs are bound,
// and how a capability's helper is launched there.
//
// The host dispatches a worker with ONE request on stdin (orbit.worker/v1) and reads back one
// envelope; the worker runs the frozen case with the same runner a person's run uses. Nothing
// the worker can reach is authoritative: its store is a scratch room in its own output, and the
// host validates the envelope and writes the ledger, the evidence and the investigation's line
// itself (src/run/envelope.mjs). What the worker is handed is SEALED: the binding table the host
// resolved (no URL a case typed, no address a model guessed) and the secrets an identity needs,
// on stdin only -- they reach a helper's environment and nothing else.
import { join } from "node:path";
import { catalogFile, readCatalog, rowsOf } from "../catalog.mjs";
import { contained } from "../project/boundary.mjs";

export const WORKER_API = "orbit.worker/v1";

const REQUEST_RULES = [
  { when: (r) => r?.v !== WORKER_API, say: `the request is not ${WORKER_API}` },
  { when: (r) => typeof r.runId !== "string" || typeof r.nonce !== "string", say: "the request names no runId and nonce" },
  { when: (r) => typeof r.case?.file !== "string" || typeof r.case?.digest !== "string", say: "the request names no frozen case file and digest" },
  { when: (r) => typeof r.out !== "string", say: "the request names no output directory" },
];

export const requestProblem = (r) => REQUEST_RULES.find((rule) => rule.when(r))?.say ?? null;

// The run-case arguments the request stands for: the frozen case BY PATH and its synthetic
// params. Evidence goes to the evidence room of the worker's own scratch store, inside its
// output, where the host lists it. Never a flag the request did not earn.
export function argvOf(r) {
  const params = Object.entries(r.params ?? {}).map(([k, v]) => `${k}=${v}`);
  return [r.case.file, ...params, "--json", ...(r.slice ? [`--from=${r.slice.from}`, `--to=${r.slice.to}`] : [])];
}

// The binder a worker gets: only what the host sealed, by kind and alias. A secret an identity
// names is handed back as environment for the helper -- the only place it may go.
export const sealedBinder = (r) => ({ resolve: (kind, ref) => sealed(r, kind, ref) });

function sealed(r, kind, ref) {
  const value = r.bindings?.[kind]?.[ref];
  if (!value) return { ok: false, why: `nothing named ${String(ref).slice(0, 60)} is bound as ${kind} for this run` };
  const env = value.env && r.secrets?.[value.env] !== undefined ? { [value.env]: String(r.secrets[value.env]) } : {};
  return { ok: true, value, env };
}

// How a helper is started where the runner runs: a pack's program, from where the plugin keeps
// it, as an argument list, under the Node binary and the minimal environment the composition
// root hands in (`base.node`, `base.env` -- src/ reads no process state of its own). Only packs
// here; a helper that wants an image of its own is not started from inside a worker, and a
// project's own tool brings its own launcher.
export function localLauncher(pluginRoot, io, base = {}) {
  return { launch: (cap, op) => launched(pluginRoot, io, base, cap) };
}

function launched(pluginRoot, io, base, cap) {
  const dir = packDir(pluginRoot, io, String(cap?.from ?? ""));
  const argv = cap?.helper?.argv ?? [];
  if (!dir || !argv.length || !base.node || cap.helper.runIn === "image") return null;
  return { file: base.node, args: [contained(dir, join(dir, argv[0])), ...argv.slice(1)], env: { ...(base.env ?? {}) } };
}

function packDir(pluginRoot, io, from) {
  if (!from.startsWith("pack:")) return null;
  const row = rowsOf(readCatalog(io, catalogFile(pluginRoot, "packs")).packs).find((p) => p.id === from.slice(5));
  return row ? contained(pluginRoot, join(pluginRoot, row.dir)) : null;
}
