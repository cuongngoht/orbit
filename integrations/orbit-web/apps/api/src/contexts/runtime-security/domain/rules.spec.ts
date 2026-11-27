// THE RULES (ADR 0063): what an attributed event IS, how severe, and what -- deterministically, no model -- is done about it.
import assert from "node:assert/strict";
import { test } from "node:test";
import { classify, incidentFor, isShellOrInterpreter, protectionIncident } from "./rules.js";

const fact = (over: Partial<Parameters<typeof classify>[0]> = {}): Parameters<typeof classify>[0] => ({ kind: "process.exec", outcome: "OBSERVED", plane: "tool-plane", binary: "/usr/bin/node", parentBinary: "/usr/local/bin/node", path: null, control: null, runKind: "assignment", ...over });

test("a process is information; a memory-only exec and a shell in the model plane are detections of their own", () => {
  assert.deepEqual(classify(fact()), { kind: "process.exec", severity: "INFO" });
  assert.deepEqual(classify(fact({ kind: "process.exit" })), { kind: "process.exit", severity: "INFO" });
  assert.deepEqual(classify(fact({ binary: "/proc/self/fd/3" })), { kind: "exec.fileless", severity: "HIGH" });
  assert.deepEqual(classify(fact({ binary: "/proc/1234/fd/7" })), { kind: "exec.fileless", severity: "HIGH" });
  assert.deepEqual(classify(fact({ plane: "model-plane", binary: "/usr/bin/dash" })), { kind: "exec.model_plane", severity: "HIGH" });
  assert.deepEqual(classify(fact({ plane: "model-plane", binary: "/opt/claude/bin/claude" })), { kind: "process.exec", severity: "INFO" });
  assert.deepEqual(classify(fact({ plane: "tool-plane", binary: "/usr/bin/bash" })), { kind: "process.exec", severity: "INFO" }, "a shell is the workstation's job");
  assert.deepEqual(classify(fact({ kind: "control.match", outcome: "OPERATION_PREVENTED", path: "/team/x.sh", control: "exec.shared-areas" })), { kind: "control.match", severity: "MEDIUM" });
  assert.deepEqual(classify(fact({ kind: "identity.mismatch", outcome: "VIOLATION_DETECTED" })), { kind: "identity.mismatch", severity: "CRITICAL" });
  assert.deepEqual(classify(fact({ kind: "workload.contained", outcome: "WORKLOAD_CONTAINED" })), { kind: "workload.contained", severity: "HIGH" });
  for (const b of ["/usr/bin/sh", "/bin/bash", "/usr/bin/python3.12", "/opt/python/bin/python3", "/usr/bin/perl", "/usr/bin/nc", "/usr/bin/curl"]) assert.equal(isShellOrInterpreter(b), true, b);
  for (const b of ["/usr/local/bin/node", "/usr/bin/git", "/opt/claude/bin/claude", "/usr/bin/rg"]) assert.equal(isShellOrInterpreter(b), false, b);
});

test("only what the workload did is judged: a program the container runtime started from outside (a docker exec) is information", () => {
  // fexecve / execveat run a memory-only program through its descriptor: the kernel names it /dev/fd/N.
  assert.deepEqual(classify(fact({ binary: "/dev/fd/3" })), { kind: "exec.fileless", severity: "HIGH" });
  // The allocator's own probes and checks arrive through Docker's exec: their parent is the runtime, on the host.
  for (const parent of ["/usr/bin/containerd-shim-runc-v2", "/usr/bin/runc", "/usr/sbin/runc", "/usr/local/bin/containerd-shim-runc-v2"]) {
    assert.deepEqual(classify(fact({ plane: "model-plane", binary: "/usr/bin/sh", parentBinary: parent })), { kind: "process.exec", severity: "INFO" }, parent);
    assert.deepEqual(classify(fact({ binary: "/proc/self/fd/6", parentBinary: parent })), { kind: "process.exec", severity: "INFO" }, `runc's own re-exec under ${parent}`);
  }
  // A program of the workload's own NAMED like the runtime is still the workload's: its path is not the host's.
  assert.deepEqual(classify(fact({ plane: "model-plane", binary: "/bin/sh", parentBinary: "/connection/runc" })), { kind: "exec.model_plane", severity: "HIGH" });
  assert.deepEqual(classify(fact({ plane: "model-plane", binary: "/bin/sh", parentBinary: "/usr/local/bin/node" })), { kind: "exec.model_plane", severity: "HIGH" });
  assert.deepEqual(classify(fact({ plane: "model-plane", binary: "/bin/sh", parentBinary: null })), { kind: "exec.model_plane", severity: "HIGH" }, "an unknown parent is never taken as the runtime");
});

test("information makes no incident; a prevention is recorded, never contained (the kernel already refused it)", () => {
  assert.equal(incidentFor({ kind: "process.exec", severity: "INFO", mode: "enforce", runKind: "assignment", runId: "r1", control: null, path: null, binary: "/usr/bin/node" }), null);
  const p = incidentFor({ kind: "control.match", severity: "MEDIUM", mode: "enforce", outcome: "OPERATION_PREVENTED", runKind: "assignment", runId: "r1", control: "exec.shared-areas", path: "/team/x.sh", binary: "/usr/bin/sh" });
  assert.deepEqual([p?.category, p?.severity, p?.respond, p?.blocksRetry], ["restricted_operation", "MEDIUM", [], false]);
  const d = incidentFor({ kind: "control.match", severity: "MEDIUM", mode: "observe", outcome: "VIOLATION_DETECTED", runKind: "assignment", runId: "r1", control: "exec.shared-areas", path: "/team/x.sh", binary: "/usr/bin/sh" });
  assert.deepEqual([d?.category, d?.respond, d?.blocksRetry], ["policy_violation", [], false]);
  assert.match(d?.title ?? "", /would have been refused|observe/i);
});

test("under enforce, a memory-only exec, a shell in the model plane and an identity mismatch stop the attempt and hold it for a person", () => {
  for (const kind of ["exec.fileless", "exec.model_plane", "identity.mismatch"] as const) {
    const enforced = incidentFor({ kind, severity: kind === "identity.mismatch" ? "CRITICAL" : "HIGH", mode: "enforce", runKind: "assignment", runId: "r1", control: null, path: null, binary: "/proc/self/fd/3" });
    assert.deepEqual([enforced?.respond, enforced?.blocksRetry], [["revoke", "stop"], true], kind);
    // Observed: reported, never acted on -- observation is not prevention, nor containment.
    const observed = incidentFor({ kind, severity: "HIGH", mode: "observe", runKind: "assignment", runId: "r1", control: null, path: null, binary: "/proc/self/fd/3" });
    assert.deepEqual([observed?.respond, observed?.blocksRetry], [[], false], kind);
  }
  // A chat (observed by the deployment's floor) is never stopped by an employee's rule.
  const chat = incidentFor({ kind: "exec.fileless", severity: "HIGH", mode: "observe", runKind: "chat", runId: "c1", control: null, path: null, binary: "/proc/self/fd/3" });
  assert.deepEqual(chat?.respond, []);
});

test("one incident per cause per attempt: the fingerprint names the run and the cause, never the moment", () => {
  const a = incidentFor({ kind: "exec.fileless", severity: "HIGH", mode: "enforce", runKind: "assignment", runId: "r1", control: null, path: null, binary: "/proc/self/fd/3" });
  const b = incidentFor({ kind: "exec.fileless", severity: "HIGH", mode: "enforce", runKind: "assignment", runId: "r1", control: null, path: null, binary: "/proc/self/fd/9" });
  const c = incidentFor({ kind: "exec.fileless", severity: "HIGH", mode: "enforce", runKind: "assignment", runId: "r2", control: null, path: null, binary: "/proc/self/fd/3" });
  assert.equal(a?.fingerprint, b?.fingerprint);
  assert.notEqual(a?.fingerprint, c?.fingerprint, "another attempt, another incident");
});

test("protection the allocator lost or contained is an incident; a containment it could not verify is critical", () => {
  assert.equal(protectionIncident({ runId: "r1", mode: "enforce", from: "PROTECTED", to: "PROTECTED", detail: "" }), null);
  const lost = protectionIncident({ runId: "r1", mode: "enforce", from: "PROTECTED", to: "UNKNOWN", detail: "the sensor restarted" });
  assert.deepEqual([lost?.category, lost?.severity, lost?.state, lost?.blocksRetry], ["protection_missing", "HIGH", "CONTAINING", true]);
  const contained = protectionIncident({ runId: "r1", mode: "enforce", from: "UNKNOWN", to: "CONTAINED", detail: "both planes stopped" });
  assert.deepEqual([contained?.category, contained?.state, contained?.fingerprint], ["protection_missing", "CONTAINED", lost?.fingerprint]);
  const stuck = protectionIncident({ runId: "r1", mode: "enforce", from: "UNKNOWN", to: "CONTAINING", detail: "Containment could not be verified: the tool-plane still run" });
  assert.deepEqual([stuck?.category, stuck?.severity], ["containment_failure", "CRITICAL"]);
  const degraded = protectionIncident({ runId: "r1", mode: "observe", from: "OBSERVING", to: "DEGRADED", detail: "the sensor is unavailable" });
  assert.deepEqual([degraded?.category, degraded?.severity, degraded?.blocksRetry], ["sensor_failure", "LOW", false]);
  // An enforced attempt that never opened because protection could not be proven: refused at admission, not an incident.
  assert.equal(protectionIncident({ runId: "r1", mode: "enforce", from: null, to: "UNKNOWN", detail: "no backend" }), null);
});

test("a containment the allocator could not verify is answered too: the run token ended and the attempt stopped, again until done", () => {
  const plan = protectionIncident({ runId: "r1", mode: "enforce", from: "UNKNOWN", to: "CONTAINING", detail: "Containment could not be verified: the tool-plane still run (x)." });
  assert.equal(plan?.category, "containment_failure");
  assert.deepEqual(plan?.respond, ["revoke", "stop"]);
  assert.equal(plan?.blocksRetry, true);
});
