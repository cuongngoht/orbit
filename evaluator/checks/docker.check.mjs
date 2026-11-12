// What a container is created with: the credential by NAME only, never a value and never another ANTHROPIC_* name;
// the tools volume read-only; limits; the evaluator's labels; and the in-container programs need nothing but Node.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { armOf } from "../lib/arms/index.mjs";
import { createArgs, labelsOf } from "../lib/core/docker.mjs";
import { cleanEnv } from "../lib/core/proc.mjs";
import { EVALUATOR_DIR } from "../lib/core/util.mjs";

const spec = { name: "evl-x-task", image: "sha256:abc", labels: labelsOf("c", "c/k/a1", "task"), network: "evl-x-net", alias: "task", env: { HOME: "/work/home" }, envNames: armOf("plain", { kind: "claude" }).credentialNames, mounts: [{ type: "volume", source: "evl-tools", target: "/opt/eval", readOnly: true }], limits: { cpus: 2, memoryMb: 4096, pids: 1024 }, argv: ["/opt/eval/bin/node", "/opt/evalrun/entry.mjs"], workdir: "/work/repo", entrypoint: "" };

test("the credential goes by name alone, and no other ANTHROPIC_* name is ever handed on", () => {
  const args = createArgs(spec);
  const envs = args.flatMap((a, i) => (a === "-e" ? [args[i + 1]] : []));
  assert.deepEqual(envs, ["HOME=/work/home", "CLAUDE_CODE_OAUTH_TOKEN"]);
  assert.ok(!args.some((a) => /^ANTHROPIC_/.test(a)));
  const env = cleanEnv({ PATH: "/bin", ANTHROPIC_BASE_URL: "http://x", ANTHROPIC_API_KEY: "k", CLAUDE_CODE_OAUTH_TOKEN: "t", SECRET: "s" }, ["CLAUDE_CODE_OAUTH_TOKEN"]);
  assert.deepEqual(env, { PATH: "/bin", CLAUDE_CODE_OAUTH_TOKEN: "t" });
});

test("the tools volume is read-only, the limits are set, the labels are the evaluator's, and there is an init", () => {
  const args = createArgs(spec);
  assert.ok(args.includes("type=volume,source=evl-tools,target=/opt/eval,readonly"));
  for (const [flag, v] of [["--cpus", "2"], ["--memory", "4096m"], ["--memory-swap", "4096m"], ["--pids-limit", "1024"], ["--network", "evl-x-net"]]) assert.equal(args[args.indexOf(flag) + 1], v, flag);
  assert.ok(args.includes("--init"));
  assert.ok(args.includes("orbit.eval=1"));
  assert.ok(args.includes("orbit.eval.run=c/k/a1"));
});

test("a container with no network is on none", () => {
  const args = createArgs({ ...spec, network: null, envNames: [] });
  assert.equal(args[args.indexOf("--network") + 1], "none");
});

test("every program copied into a container imports nothing but Node", () => {
  for (const f of ["entry.mjs", "egress.mjs", "scripted.mjs", "grade-pack.mjs"]) {
    const text = readFileSync(join(EVALUATOR_DIR, "lib", "container", f), "utf8");
    const specs = [...text.matchAll(/\bfrom\s+"([^"]+)"/g)].map((m) => m[1]);
    assert.deepEqual(specs.filter((s) => !s.startsWith("node:")), [], f);
  }
});
