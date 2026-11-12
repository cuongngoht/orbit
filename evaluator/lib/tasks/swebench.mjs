// SWE-BENCH VERIFIED as a task source. Rows are fetched from the Hugging Face datasets server once, while the dataset's
// revision is the one pinned here (checked against the hub's API first), and cached OUTSIDE the repository under
// $ORBIT_EVAL_HOME/datasets/; each row a campaign uses is pinned by the sha256 of its canonical JSON. The agent is
// given the row's `problem_statement` and nothing else of it -- never its hints, patch, test patch or test names.
//
// The agent's container is the row's instance image (the official one, pulled through the daemon's mirror), with the
// repository at /testbed in the image's own checkout; the start tree is that checkout as the image holds it. The grader
// is the official harness (grade/swebench.mjs).
//
//   datasetRows(home) -> [row]      rowOf(home, id) -> row      rowDigest(row)      imageOf(id)      swebenchTask(id, ctx)
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { copyOut, createContainer, ensureImage, labelsOf, removeContainer } from "../core/docker.mjs";
import { gitMust, privateGitDir, treeOfWork } from "../core/git.mjs";
import { cleanEnv, run } from "../core/proc.mjs";
import { canonical, ensureDir, evalHome, sha256, writeJson } from "../core/util.mjs";
import { gradeSwebench } from "../grade/swebench.mjs";

export const DATASET = "princeton-nlp/SWE-bench_Verified";

export const REVISION = "c104f840cc67f8b6eec6f759ebc8b2693d585d4a";

export const ROWS = 500;

const PAGE = 100;

// What reaches a network tool: the proxy and CA names it needs, nothing else of this environment.
export const NETWORK_NAMES = ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy", "NO_PROXY", "no_proxy", "SSL_CERT_FILE", "CURL_CA_BUNDLE", "REQUESTS_CA_BUNDLE", "NODE_EXTRA_CA_CERTS", "UV_CACHE_DIR"];

const fetched = (url) => {
  const r = run(["curl", "-sS", "--fail", "--max-time", "180", "--retry", "3", url], { env: cleanEnv(process.env, NETWORK_NAMES), max: 256 * 1024 * 1024 });
  if (!r.ok) throw new Error(`fetching ${url} failed: ${String(r.err).trim().slice(-300)}`);
  return JSON.parse(r.out);
};

export const cacheFileOf = (home) => join(home, "datasets", `swe-bench-verified-${REVISION.slice(0, 12)}.json`);

function fetchedRows() {
  const hub = fetched(`https://huggingface.co/api/datasets/${DATASET}`);
  if (hub.sha !== REVISION) throw new Error(`${DATASET} is at revision ${hub.sha} now, and this evaluator pins ${REVISION}: the rows served would not be the pinned ones`);
  const pages = Array.from({ length: ROWS / PAGE }, (_, i) => fetched(`https://datasets-server.huggingface.co/rows?dataset=${encodeURIComponent(DATASET)}&config=default&split=test&offset=${i * PAGE}&length=${PAGE}`));
  const rows = pages.flatMap((p) => p.rows.map((r) => r.row));
  if (rows.length !== ROWS || new Set(rows.map((r) => r.instance_id)).size !== ROWS) throw new Error(`expected ${ROWS} distinct rows, got ${rows.length}`);
  return rows;
}

export function datasetRows(home = evalHome()) {
  const file = cacheFileOf(home);
  if (existsSync(file)) return JSON.parse(readFileSync(file, "utf8")).rows;
  const rows = fetchedRows();
  writeJson(file, { dataset: DATASET, revision: REVISION, fetchedAt: new Date().toISOString(), rows });
  return rows;
}

export const rowDigest = (row) => sha256(canonical(row));

export function rowOf(home, id) {
  const row = datasetRows(home).find((r) => r.instance_id === id);
  if (!row) throw new Error(`swebench:${id} is not a row of ${DATASET}@${REVISION.slice(0, 12)}`);
  return row;
}

// The official instance image: docker hub has no double underscore, so `__` is written `_1776_` (swebench's own rule).
export const imageOf = (id) => `swebench/sweb.eval.x86_64.${id.toLowerCase().replace(/__/g, "_1776_")}:latest`;

export const REPO = "/testbed";

// The start: the image's /testbed copied out of a container that never runs, its tree staged as it is -- untracked
// files the image's own setup left included, so they are never mistaken for the agent's.
async function startOf(id, scratch, ctx) {
  const img = ensureImage(imageOf(id));
  if (!img.ok) return { infra: { code: "DOCKER", says: img.why } };
  const name = `evl-start-${sha256(scratch).slice(0, 12)}`;
  const c = createContainer({ name, image: img.id, labels: labelsOf(ctx?.campaign?.id ?? "start", `start/${id}`, "start"), network: null, argv: ["true"], entrypoint: "" });
  if (!c.ok) return { infra: { code: "DOCKER", says: c.why } };
  try {
    rmSync(scratch, { recursive: true, force: true });
    ensureDir(join(scratch, ".."));
    if (!copyOut(name, REPO, scratch).ok) return { infra: { code: "DOCKER", says: `could not copy ${REPO} out of ${imageOf(id)}` } };
  } finally {
    removeContainer(name);
  }
  const base = gitMust(["rev-parse", "HEAD"], { cwd: scratch }).out.trim();
  const gd = privateGitDir(join(scratch, ".git"), join(scratch, "..", "start.git"));
  return { copyIn: [], gitDir: join(scratch, ".git"), base, startTree: treeOfWork(gd, scratch, base), image: img.id, pulled: img.pulled };
}

export function swebenchTask(id, ctx = {}) {
  const row = rowOf(ctx.home ?? evalHome(), id);
  return {
    ref: `swebench:${id}`,
    source: "swebench",
    image: imageOf(id),
    repo: REPO,
    issue: row.problem_statement,
    digest: rowDigest(row),
    pin: { dataset: DATASET, revision: REVISION, row: rowDigest(row) },
    controlPatch: (name) => (name === "gold" ? Buffer.from(row.patch, "utf8") : null),
    start: (scratch, c) => startOf(id, scratch, c),
    grade: (g) => gradeSwebench(row, g),
  };
}
