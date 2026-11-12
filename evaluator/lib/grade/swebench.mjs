// GRADING A SWE-BENCH ROW with the official harness: `swebench` pinned in a uv virtualenv under
// $ORBIT_EVAL_HOME/tools/ (4.1.0: the 5.x line reads a different dataset format, with images and eval scripts in the
// rows, which the princeton-nlp rows do not carry), run on the patch alone against a local JSON of the one row, in the
// instance image the harness pulls from the `swebench` namespace. Its report is mapped onto what an outcome needs:
// FAIL_TO_PASS all passing and PASS_TO_PASS none failing is resolved; a PASS_TO_PASS failure is a regression.
//
//   ensureSwebench(home) -> { ok, python, version }      gradeSwebench(row, ctx) -> grade      gradedFromReport(report, id)
import { copyFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanEnv, run } from "../core/proc.mjs";
import { ensureDir, evalHome, sha256, writeJson, writeText } from "../core/util.mjs";

export const SWEBENCH_VERSION = "4.1.0";

export const PYTHON_VERSION = "3.11";

const NETWORK_NAMES = ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy", "NO_PROXY", "no_proxy", "SSL_CERT_FILE", "REQUESTS_CA_BUNDLE", "UV_CACHE_DIR", "DOCKER_HOST"];

const venvOf = (home) => join(home, "tools", `swebench-${SWEBENCH_VERSION}`);

const pythonOf = (home) => join(venvOf(home), "bin", "python");

// The harness's own environment: uv's and docker's names, never a credential's.
const toolEnv = () => cleanEnv(process.env, NETWORK_NAMES);

export function ensureSwebench(home = evalHome()) {
  if (existsSync(join(venvOf(home), "READY"))) return { ok: true, python: pythonOf(home), version: SWEBENCH_VERSION };
  ensureDir(join(home, "tools"));
  const steps = [["uv", "venv", "-q", "--clear", "--python", PYTHON_VERSION, venvOf(home)], ["uv", "pip", "install", "-q", "--python", pythonOf(home), `swebench==${SWEBENCH_VERSION}`]];
  for (const argv of steps) {
    const r = run(argv, { env: toolEnv(), timeoutMs: 1800000 });
    if (!r.ok) return { ok: false, why: `${argv.slice(0, 3).join(" ")}: ${String(r.err).trim().slice(-300)}` };
  }
  writeText(join(venvOf(home), "READY"), `swebench==${SWEBENCH_VERSION}\n`);
  return { ok: true, python: pythonOf(home), version: SWEBENCH_VERSION };
}

const statusOf = (report, key) => report?.tests_status?.[key] ?? { success: [], failure: [] };

export function gradedFromReport(report, id) {
  const r = report?.[id];
  if (!r) return { ran: false, applied: false, why: "the harness wrote no report for this instance" };
  if (!r.patch_successfully_applied) return { ran: true, applied: false, why: "the harness could not apply the patch" };
  const f2p = statusOf(r, "FAIL_TO_PASS");
  const p2p = statusOf(r, "PASS_TO_PASS");
  return { ran: true, applied: true, resolved: r.resolved === true, regressed: p2p.failure.length > 0, f2pFailed: f2p.failure, p2pFailed: p2p.failure, counts: { f2pPassed: f2p.success.length, f2pFailed: f2p.failure.length, p2pPassed: p2p.success.length, p2pFailed: p2p.failure.length } };
}

// ctx: { patchFile, scratch, names, room, home }
export async function gradeSwebench(row, ctx) {
  const tools = ensureSwebench(ctx.home);
  if (!tools.ok) return { ran: false, applied: false, why: tools.why };
  const dir = ensureDir(join(ctx.scratch, "swebench"));
  const runId = `evl-${sha256(ctx.names.label ?? ctx.names.grader).slice(0, 12)}`;
  writeJson(join(dir, "dataset.json"), [row]);
  writeText(join(dir, "predictions.jsonl"), `${JSON.stringify({ instance_id: row.instance_id, model_name_or_path: "evaluator", model_patch: readFileSync(ctx.patchFile, "utf8") })}\n`);
  const argv = [tools.python, "-m", "swebench.harness.run_evaluation", "--dataset_name", join(dir, "dataset.json"), "--predictions_path", join(dir, "predictions.jsonl"), "--run_id", runId, "--max_workers", "1", "--namespace", "swebench", "--cache_level", "instance", "--timeout", "1800", "--report_dir", dir];
  const r = run(argv, { cwd: dir, env: toolEnv(), timeoutMs: 3 * 3600000, max: 64 * 1024 * 1024 });
  writeText(join(ctx.room, "harness.log"), `${String(r.out).slice(-200000)}\n${String(r.err).slice(-200000)}`);
  const logDir = join(dir, "logs", "run_evaluation", runId, "evaluator", row.instance_id);
  for (const f of ["report.json", "test_output.txt", "run_instance.log"]) if (existsSync(join(logDir, f))) copyFileSync(join(logDir, f), join(ctx.room, `swebench-${f}`));
  const report = existsSync(join(logDir, "report.json")) ? JSON.parse(readFileSync(join(logDir, "report.json"), "utf8")) : null;
  return { ...gradedFromReport(report, row.instance_id), harness: { swebench: tools.version, exit: r.code, runId } };
}
