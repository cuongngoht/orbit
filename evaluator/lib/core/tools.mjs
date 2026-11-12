// THE TOOLS VOLUME: Node and ONE pinned Claude Code, installed once into a docker volume and mounted READ-ONLY at
// /opt/eval in every task container, whatever its image -- a pack's node:22 or a SWE-bench instance image (Ubuntu
// 22.04, glibc) -- so every arm of every task runs the same host binary, and the task image needs nothing of its own.
// The volume is named by the Claude Code version and the Node image it was built from, carries the evaluator's labels,
// and holds TOOLS.json (written last) saying what is in it; a volume without it is incomplete and is built again.
import { CLAUDE_CODE_VERSION, NODE_IMAGE, TOOLS_MOUNT } from "./versions.mjs";
import { createVolume, docker, ensureImage, labelsOf, removeVolume, volumeExists } from "./docker.mjs";

export const volumeNameOf = (nodeImageId) => `evl-tools-cc-${CLAUDE_CODE_VERSION}-${nodeImageId.replace(/^sha256:/, "").slice(0, 12)}`;

const toolsRun = (volume, args, o = {}) => docker(["run", "--rm", "--label", "orbit.eval=1", "--label", "orbit.eval.role=tools-build", "--mount", `type=volume,source=${volume},target=${TOOLS_MOUNT}${o.readOnly ? ",readonly" : ""}`, ...(o.caFile ? ["--mount", `type=bind,source=${o.caFile},target=/run/eval-ca.pem,readonly`, "-e", "NODE_EXTRA_CA_CERTS=/run/eval-ca.pem"] : []), "-e", "NPM_CONFIG_UPDATE_NOTIFIER=false", "-e", "NPM_CONFIG_FUND=false", "-e", "NPM_CONFIG_AUDIT=false", ...(o.network === false ? ["--network", "none"] : []), NODE_IMAGE, ...args], { timeoutMs: 1800000 });

function readTools(volume) {
  const r = toolsRun(volume, ["cat", `${TOOLS_MOUNT}/TOOLS.json`], { readOnly: true, network: false });
  try { return r.ok ? JSON.parse(r.out) : null; }
  catch { return null; }
}

const failed = (step, r) => ({ ok: false, why: `${step}: ${String(r.err || r.out).trim().slice(-400)}` });

function built(volume, nodeImageId, caFile) {
  const install = toolsRun(volume, ["npm", "install", "-g", "--prefix", TOOLS_MOUNT, `@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}`], { caFile });
  if (!install.ok) return failed("npm install of Claude Code", install);
  const node = toolsRun(volume, ["cp", "/usr/local/bin/node", `${TOOLS_MOUNT}/bin/node`]);
  if (!node.ok) return failed("copying node", node);
  const cc = toolsRun(volume, [`${TOOLS_MOUNT}/bin/claude`, "--version"], { network: false });
  const nv = toolsRun(volume, [`${TOOLS_MOUNT}/bin/node`, "--version"], { network: false });
  if (!cc.ok || !cc.out.includes(CLAUDE_CODE_VERSION)) return failed("claude --version", cc);
  const tools = { claudeCode: CLAUDE_CODE_VERSION, claudeCodeSays: cc.out.trim(), node: nv.out.trim(), nodeImage: NODE_IMAGE, nodeImageId, builtAt: new Date().toISOString() };
  const w = toolsRun(volume, [`${TOOLS_MOUNT}/bin/node`, "-e", "require('fs').writeFileSync(process.argv[1], process.argv[2])", `${TOOLS_MOUNT}/TOOLS.json`, JSON.stringify(tools, null, 2)], { network: false });
  return w.ok ? { ok: true, ...tools } : failed("writing TOOLS.json", w);
}

// The volume, built when it is missing or incomplete: { ok, volume, claudeCode, node, nodeImageId } or { ok: false, why }.
export function ensureTools(o = {}) {
  const img = ensureImage(NODE_IMAGE);
  if (!img.ok) return img;
  const volume = volumeNameOf(img.id);
  const have = volumeExists(volume) ? readTools(volume) : null;
  if (have?.claudeCode === CLAUDE_CODE_VERSION) return { ok: true, volume, built: false, ...have };
  if (volumeExists(volume)) removeVolume(volume);
  const c = createVolume(volume, labelsOf("tools", "tools", "tools"));
  if (!c.ok) return failed("docker volume create", c);
  const b = built(volume, img.id, o.caFile);
  if (!b.ok) removeVolume(volume);
  return b.ok ? { ...b, volume, built: true } : b;
}
