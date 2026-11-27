// THE POLICY COMPILER (ADR 0063): an attempt's effective runtime security -- controls from governance-core's catalog,
// never a hook, a path or a YAML a person or an agent wrote -- becomes ONE Tetragon TracingPolicy scoped to THAT
// attempt's two mount namespaces, and nothing else. What it cannot scope it refuses: a missing or shared namespace, an
// unknown control, a plane missing. It never falls back to a broader rule.
//
// One hook (the BPF LSM's bprm_check_security: the file about to be executed, as the kernel resolved it), one selector
// per plane and target, each naming the plane's namespace; Override with -EPERM refuses the exec before it happens. A
// canary selector (an exact path baked into both images) is in every policy: an exec of it is refused only where the
// policy really binds, which is what a probe proves before the attempt opens and what the PoC proved per kernel.
//
// The mode is not in the document: it is given when the policy is installed (`tetra tracingpolicy add --mode`) and read
// back with it, so the same digest serves observe (monitor: report, never refuse) and enforce.
import { createHash } from "node:crypto";
import { isRuntimeControlId, RUNTIME_CONTROL_IDS, type RuntimeControlId, type RuntimePlane } from "@orbit-web/governance-core";

// A copy of /bin/true baked into the workstation and model-plane images (docker/Dockerfile): no workload runs it.
export const CANARY_PATH = "/usr/local/libexec/orbit-web/runtime-canary";

// Where each control reaches, per plane: areas an attempt's programs never need to EXECUTE from (shared with other
// employees, delivered to people, handed in, or holding the connection's sign-in). Paths as the kernel resolves them.
export const CONTROL_TARGETS: Record<RuntimeControlId, Partial<Record<RuntimePlane, readonly string[]>>> = {
  "exec.shared-areas": { "tool-plane": ["/team/", "/output/", "/input/"], "model-plane": ["/connection/"] },
};

export const CANARY_POLICY = "orbit-canary-host";

export class PolicyCompileError extends Error {}

const sha = (text: string): string => createHash("sha256").update(text).digest("hex");

// One name per attempt AND per pair of containers: recreated containers are a new policy, never the old one's.
export const policyNameOf = (dispatchKey: string, containerIds: readonly string[]): string => `orbit-a-${sha(dispatchKey).slice(0, 12)}-${sha(containerIds.join(":")).slice(0, 12)}`;

// Orbit's own policies -- the only ones Orbit ever reaps. An operator's own policy is never touched.
export const isOrbitPolicy = (name: string): boolean => name.startsWith("orbit-a-") || name === CANARY_POLICY;

export interface PlaneBinding {
  plane: RuntimePlane;
  containerId: string;
  // The plane's mount namespace inode, as the plane reported it AND the sensor confirmed it.
  mntNs: string;
}

export interface CompiledPolicy {
  name: string;
  yaml: string;
  digest: string;
  // The namespaces it names (tool plane first): what another policy must never also hold.
  inodes: string[];
  controls: RuntimeControlId[];
}

const INODE = /^[1-9]\d{0,19}$/;
const quote = (s: string): string => JSON.stringify(s);

function selector(inodes: readonly string[], operator: "Prefix" | "Equal", values: readonly string[]): string[] {
  return [
    "    - matchNamespaces:",
    "      - namespace: Mnt",
    "        operator: In",
    `        values: [${inodes.map(quote).join(", ")}]`,
    "      matchArgs:",
    "      - index: 0",
    `        operator: ${operator}`,
    `        values: [${values.map(quote).join(", ")}]`,
    "      matchActions:",
    "      - action: Override",
    "        argError: -1",
  ];
}

function document(name: string, selectors: string[]): string {
  return ["apiVersion: cilium.io/v1alpha1", "kind: TracingPolicy", "metadata:", `  name: ${quote(name)}`, "spec:", "  lsmhooks:", "  - hook: bprm_check_security", "    args:", "    - index: 0", "      type: linux_binprm", "    selectors:", ...selectors, ""].join("\n");
}

export function compileAttemptPolicy(i: { dispatchKey: string; planes: readonly PlaneBinding[]; controls: readonly RuntimeControlId[] }): CompiledPolicy {
  if (typeof i.dispatchKey !== "string" || i.dispatchKey === "") throw new PolicyCompileError("an attempt's policy is named from its dispatch key: none was given");
  const tool = i.planes.find((p) => p.plane === "tool-plane");
  const model = i.planes.find((p) => p.plane === "model-plane");
  if (i.planes.length !== 2 || tool === undefined || model === undefined) throw new PolicyCompileError("an attempt's policy names both planes, the tool plane and the model plane, once each");
  for (const p of [tool, model]) if (typeof p.mntNs !== "string" || !INODE.test(p.mntNs)) throw new PolicyCompileError(`the ${p.plane} has no mount namespace inode to scope a policy to (got ${JSON.stringify(p.mntNs)}): a policy without one would bind every process on the host`);
  if (tool.mntNs === model.mntNs) throw new PolicyCompileError("the two planes cannot share a mount namespace: that is not an attempt Orbit made");
  for (const c of i.controls) if (!isRuntimeControlId(c)) throw new PolicyCompileError(`${String(c)} is not a runtime control Orbit Web offers`);
  const chosen = new Set(i.controls);
  const controls = RUNTIME_CONTROL_IDS.filter((id) => chosen.has(id));
  const selectors: string[] = [];
  for (const id of controls) {
    for (const p of [tool, model]) {
      const targets = CONTROL_TARGETS[id][p.plane];
      if (targets !== undefined && targets.length > 0) selectors.push(...selector([p.mntNs], "Prefix", targets));
    }
  }
  selectors.push(...selector([tool.mntNs, model.mntNs], "Equal", [CANARY_PATH]));
  const name = policyNameOf(i.dispatchKey, [tool.containerId, model.containerId]);
  const yaml = document(name, selectors);
  return { name, yaml, digest: sha(yaml), inodes: [tool.mntNs, model.mntNs], controls };
}

// The host's own canary: the canary path refused in ONE container's namespace (the in-scope canary container), and
// nothing anywhere else -- the out-of-scope canary running it is what proves the scope is not the host.
export function compileCanaryPolicy(mntNs: string): CompiledPolicy {
  if (!INODE.test(mntNs)) throw new PolicyCompileError("the canary container has no mount namespace inode");
  const yaml = document(CANARY_POLICY, selector([mntNs], "Equal", [CANARY_PATH]));
  return { name: CANARY_POLICY, yaml, digest: sha(yaml), inodes: [mntNs], controls: [] };
}
