// EMPLOYEE NETWORK ACCESS: AUTONOMOUS by default, RESTRICTED to an allow-list by choice; validated, part of the digest,
// decided for an assignment's connections only, narrowed by any deny, and worked out as a risk when it changes.
import assert from "node:assert/strict";
import { test } from "node:test";
import { canonicalJson, digestOf } from "./canonical.js";
import { checkConstitution, checkOverlay, defaultAccountPolicy, type Constitution, type PolicyOverlay, type Rule } from "./constitution.js";
import { evaluate, type GovernanceRequest } from "./evaluate.js";
import { allowListed, EMPLOYEE_NETWORK_DISCLOSURE, employeeNetworkChanges, employeeNetworkErrors, employeeNetworkOf, entryAllows, egressTargetOf, isAllowEntry, networkHostOf, type EmployeeNetwork } from "./network.js";
import { impactOf } from "./risk.js";
import { tableOf, withTable } from "./table.js";
import { ENFORCEMENT_SCOPES, isRunKind, REASON_CODES, RUN_KINDS, RUN_SCOPES } from "./vocabulary.js";
import { ACCOUNT, ask, sha256 } from "./testing.spec-helpers.js";

const base = (): Constitution => defaultAccountPolicy(ACCOUNT, "governed");
const withNetwork = (employeeNetwork: EmployeeNetwork | undefined, over: Partial<Constitution> = {}): Constitution => {
  const { employeeNetwork: _default, ...rest } = base();
  return { ...rest, ...(employeeNetwork !== undefined ? { employeeNetwork } : {}), ...over };
};
const restricted = (allow: string[], limits?: EmployeeNetwork["limits"]): Constitution => withNetwork({ mode: "RESTRICTED", allow, ...(limits !== undefined ? { limits } : {}) });
const autonomous = (limits?: EmployeeNetwork["limits"], allow: string[] = []): Constitution => withNetwork({ mode: "AUTONOMOUS", allow, ...(limits !== undefined ? { limits } : {}) });
const policy = (constitution: Constitution, overlays: PolicyOverlay[] = []) => ({ constitution, overlays });
// A connection asked by an employee's assignment run: what the egress proxy asks for each one.
const employee = (resource: string, over: Partial<GovernanceRequest> = {}): GovernanceRequest => ask({ action: "network.egress", resource, workspaceId: null, runKind: "assignment", employeeId: "emp-1", ...over });
const decide = (c: Constitution, resource: string, over: Partial<GovernanceRequest> = {}, overlays: PolicyOverlay[] = []) => evaluate(policy(c, overlays), employee(resource, over));
const overlay = (level: PolicyOverlay["metadata"]["level"], target: string, rules: Rule[]): PolicyOverlay => ({ apiVersion: "orbit.governance/v2", kind: "PolicyOverride", metadata: { accountId: ACCOUNT, level, target, name: "narrow" }, rules });
const errorsOf = (body: unknown): string[] => {
  const c = checkConstitution(body);
  return c.ok ? [] : c.errors;
};

test("a new account's policy says AUTONOMOUS in both deployments; a policy that does not say it means AUTONOMOUS with no limit", () => {
  for (const deployment of ["single", "governed"] as const) {
    const p = defaultAccountPolicy(ACCOUNT, deployment);
    assert.deepEqual(p.employeeNetwork, { mode: "AUTONOMOUS", allow: [] }, deployment);
    assert.equal(checkConstitution(p).ok, true, deployment);
  }
  const unsaid = withNetwork(undefined);
  assert.equal(Object.hasOwn(unsaid, "employeeNetwork"), false);
  assert.equal(checkConstitution(unsaid).ok, true, "a policy written before the field existed is still a valid policy");
  assert.deepEqual(employeeNetworkOf(unsaid), { mode: "AUTONOMOUS", allow: [] });
  assert.deepEqual(decide(unsaid, "example.com:443").reasonCodes, ["EMPLOYEE_NETWORK_AUTONOMOUS"]);
  assert.match(EMPLOYEE_NETWORK_DISCLOSURE, /^In Autonomous mode an employee can send the data of its assignment to any public website\. Use Restricted mode, or do not give it data that must not leave\.$/);
});

test("employeeNetwork is validated: its mode, every allow-list entry, duplicates, each limit and every field", () => {
  const good = restricted(["api.github.com", "*.pythonhosted.org", "registry.npmjs.org", "93.184.215.14", "intranet"], { bandwidthMbpsPerRun: 10, downloadBytesPerRun: 1_000_000, downloadBytesPerDay: 5_000_000_000, connectionsPerMinutePerRun: 600, concurrentConnectionsPerRun: 32 });
  assert.deepEqual(errorsOf(good), []);
  assert.deepEqual(errorsOf(autonomous({})), [], "an empty set of limits is no limit");
  for (const bad of ["https://example.com", "example.com:443", "example.com/path", "Example.com", "*.com", "*", "*example.com", "a.*.example.com", "a..b", "-a.example.com", "a-.example.com", "a b.example.com", "", "x".repeat(64) + ".example.com", 7, null]) {
    assert.equal(isAllowEntry(bad), false, String(bad));
    assert.match(errorsOf(restricted([bad as string])).join(" | "), /employeeNetwork\.allow\[0\] must be a host/, String(bad));
  }
  assert.ok(errorsOf(restricted(["a.example.com", "a.example.com"])).some((e) => e.includes('"a.example.com" is listed twice')));
  assert.ok(errorsOf(restricted(Array.from({ length: 201 }, (_, i) => `h${i}.example.com`))).some((e) => e.includes("more than 200 hosts")));
  const wrong = employeeNetworkErrors({ mode: "OPEN", allow: "example.com", limits: { bandwidthMbpsPerRun: 0, downloadBytesPerRun: -1, downloadBytesPerDay: 1.5, connectionsPerMinutePerRun: "10", concurrentConnectionsPerRun: 2 ** 53, perHost: 1 }, extra: true });
  for (const needle of ["employeeNetwork.extra is not a known field", 'employeeNetwork.mode must be "AUTONOMOUS" or "RESTRICTED"', "employeeNetwork.allow must be a list", "limits.perHost is not a known field", "limits.bandwidthMbpsPerRun must be", "limits.downloadBytesPerRun must be", "limits.downloadBytesPerDay must be", "limits.connectionsPerMinutePerRun must be", "limits.concurrentConnectionsPerRun must be"]) {
    assert.ok(wrong.some((e) => e.includes(needle)), `${needle} in ${wrong.join(" | ")}`);
  }
  assert.deepEqual(employeeNetworkErrors({ mode: "AUTONOMOUS" }), ["employeeNetwork.allow must be a list of hosts (empty for none)"]);
  assert.deepEqual(employeeNetworkErrors("AUTONOMOUS"), ["employeeNetwork must be an object"]);
  assert.deepEqual(employeeNetworkErrors({ mode: "AUTONOMOUS", allow: [], limits: [] }), ["employeeNetwork.limits must be an object"]);
  assert.ok(errorsOf({ ...base(), employeeNetwork: { mode: "RESTRICTED", allow: ["ok.example.com"], limits: { downloadBytesPerDay: 0 } } }).some((e) => e.startsWith("employeeNetwork.limits.downloadBytesPerDay")));
  // What a person types becomes an entry, or nothing.
  assert.deepEqual(
    [" Registry.NPMJS.org ", "*.Example.COM", "example.com:443", "http://example.com", "*.com"].map(networkHostOf),
    ["registry.npmjs.org", "*.example.com", null, null, null],
  );
});

test("the digest covers employeeNetwork: what it says changes the digest, how its keys are written does not, and a policy that does not say it keeps its digest", () => {
  const unsaid = withNetwork(undefined);
  const checked = checkConstitution(unsaid);
  assert.equal(checked.ok && Object.hasOwn(checked.value, "employeeNetwork"), false, "checking a policy adds nothing to it");
  assert.equal(digestOf(unsaid, sha256), digestOf(JSON.parse(canonicalJson(unsaid)), sha256));
  const said = autonomous();
  assert.notEqual(digestOf(said, sha256), digestOf(unsaid, sha256), "said and not said are two documents, though they mean the same");
  const listed = restricted(["api.github.com", "*.pypi.org"]);
  const reordered = { ...listed, employeeNetwork: { allow: ["api.github.com", "*.pypi.org"], mode: "RESTRICTED" as const } };
  assert.equal(digestOf(reordered, sha256), digestOf(listed, sha256), "the order of its keys is not content");
  for (const other of [restricted(["*.pypi.org", "api.github.com"]), restricted(["api.github.com"]), autonomous(undefined, ["api.github.com", "*.pypi.org"]), restricted(["api.github.com", "*.pypi.org"], { downloadBytesPerRun: 1 })]) {
    assert.notEqual(digestOf(other, sha256), digestOf(listed, sha256), JSON.stringify(other.employeeNetwork));
  }
  assert.equal(digestOf(defaultAccountPolicy(ACCOUNT, "governed"), sha256), digestOf(defaultAccountPolicy(ACCOUNT, "governed"), sha256));
});

test("AUTONOMOUS: an employee's connection reaches any host on port 80 or 443, and no other port", () => {
  const p = autonomous();
  assert.deepEqual(decide(p, "example.com:443"), { verdict: "allow", matchedRules: ["employee-network:autonomous"], reasonCodes: ["EMPLOYEE_NETWORK_AUTONOMOUS"], enforcement: "boundary" });
  assert.equal(decide(p, "files.example.org:80").verdict, "allow");
  assert.equal(decide(p, "API.Example.com:443").verdict, "allow");
  for (const resource of ["example.com:22", "example.com:8443", "example.com:0", "example.com:70000", "example.com", ":443", "exa mple.com:443", "[::1]:443", "example.com:44a"]) {
    assert.deepEqual(decide(p, resource), { verdict: "deny", matchedRules: [], reasonCodes: ["EMPLOYEE_NETWORK_PORT"], enforcement: "boundary" }, resource);
  }
  // Under the same policy a chat is held to the rules, as always: the governed default reaches the Claude hosts only.
  assert.deepEqual(evaluate(policy(p), ask({ action: "network.egress", resource: "example.com:443" })).reasonCodes, ["DEFAULT_DECISION"]);
});

test("RESTRICTED: an employee's connection reaches only the hosts the allow-list names, on 80 or 443", () => {
  const p = restricted(["api.github.com", "*.pythonhosted.org"]);
  assert.deepEqual(decide(p, "api.github.com:443"), { verdict: "allow", matchedRules: ["employee-network:api.github.com"], reasonCodes: ["EMPLOYEE_NETWORK_ALLOWED"], enforcement: "boundary" });
  assert.equal(decide(p, "api.github.com:80").verdict, "allow");
  assert.deepEqual(decide(p, "files.pythonhosted.org:443").matchedRules, ["employee-network:*.pythonhosted.org"]);
  assert.equal(decide(p, "a.b.pythonhosted.org:443").verdict, "allow", "a domain is every host under it, however deep");
  for (const resource of ["github.com:443", "pythonhosted.org:443", "evilpythonhosted.org:443", "api.github.com.evil.example:443"]) {
    assert.deepEqual(decide(p, resource), { verdict: "deny", matchedRules: [], reasonCodes: ["EMPLOYEE_NETWORK_NOT_LISTED"], enforcement: "boundary" }, resource);
  }
  assert.deepEqual(decide(p, "api.github.com:22").reasonCodes, ["EMPLOYEE_NETWORK_PORT"], "a listed host is still reached on 80 and 443 only");
  // The default policy's allow rules for the Claude account's hosts are a chat's: they open nothing to an employee.
  assert.deepEqual(decide(p, "api.anthropic.com:443").reasonCodes, ["EMPLOYEE_NETWORK_NOT_LISTED"]);
  assert.deepEqual(decide(restricted([]), "example.com:443").reasonCodes, ["EMPLOYEE_NETWORK_NOT_LISTED"], "an empty allow-list reaches nothing");
  assert.equal(entryAllows("*.example.com", "example.com"), false);
  assert.equal(entryAllows("*.example.com", "x.example.com"), true);
  assert.equal(allowListed(["a.example.com", "*.example.com"], "a.example.com"), "a.example.com", "the first entry that lets it in");
  assert.deepEqual([egressTargetOf("Example.COM:443"), egressTargetOf("example.com"), egressTargetOf("example.com:65536")], [{ host: "example.com", port: 443 }, null, null]);
});

test("a deny of the policy, or of an override, still wins over the mode; an allow never opens what the mode does not", () => {
  const block: Rule = { id: "no-tracker", action: "network.egress", resource: "tracker.example:443", effect: "deny" };
  const p = withNetwork({ mode: "AUTONOMOUS", allow: [] }, { rules: [...base().rules, block] });
  assert.deepEqual(decide(p, "tracker.example:443"), { verdict: "deny", matchedRules: ["employee-network:autonomous", "account:no-tracker"], reasonCodes: ["EMPLOYEE_NETWORK_AUTONOMOUS", "RULE_MATCHED"], enforcement: "boundary" });
  assert.equal(decide(p, "tracker.example:80").verdict, "allow", "the rule names one port");
  const prefix = withNetwork({ mode: "AUTONOMOUS", allow: [] }, { rules: [{ id: "no-ads", action: "network.egress", resource: "ads.*", effect: "deny" }] });
  assert.equal(decide(prefix, "ads.example.com:443").verdict, "deny");
  const people = withNetwork({ mode: "AUTONOMOUS", allow: [] }, { rules: [{ id: "people-only", action: "network.egress", principalType: "human", effect: "deny" }] });
  assert.equal(decide(people, "example.com:443").verdict, "allow", "a rule for people does not speak to an employee's run");
  const approval = withNetwork({ mode: "AUTONOMOUS", allow: [] }, { rules: [{ id: "ask-first", action: "network.egress", resource: "partner.example:443", effect: "require_approval" }] });
  assert.deepEqual([decide(approval, "partner.example:443").verdict, decide(approval, "partner.example:443").reasonCodes], ["require_approval", ["EMPLOYEE_NETWORK_AUTONOMOUS", "RULE_MATCHED"]]);
  const opens = restricted(["api.github.com"]);
  const widen = { ...opens, rules: [...opens.rules, { id: "open-github", action: "network.egress", resource: "github.com:443", effect: "allow" } as Rule] };
  assert.deepEqual(decide(widen, "github.com:443").reasonCodes, ["EMPLOYEE_NETWORK_NOT_LISTED"], "an allow rule is a chat's, never an employee's way past the allow-list");
  // An override of the employee narrows that employee's runs, and nobody else's; a chat's override never reaches them.
  const mine = overlay("employee", "emp-1", [{ id: "block", action: "network.egress", resource: "example.com:443", effect: "deny" }]);
  assert.deepEqual(decide(autonomous(), "example.com:443", {}, [mine]), { verdict: "deny", matchedRules: ["employee-network:autonomous", "employee:emp-1:block"], reasonCodes: ["EMPLOYEE_NETWORK_AUTONOMOUS", "OVERLAY_NARROWED"], enforcement: "boundary" });
  assert.equal(decide(autonomous(), "example.com:443", { employeeId: "emp-2" }, [mine]).verdict, "allow");
  const chats = overlay("workspace", "ws-1", [{ id: "block", action: "network.egress", effect: "deny" }]);
  assert.equal(decide(autonomous(), "example.com:443", {}, [chats]).verdict, "allow");
  const wide = overlay("employee", "emp-1", [{ id: "open", action: "network.egress", resource: "github.com:443", effect: "allow" }]);
  assert.equal(decide(restricted([]), "github.com:443", {}, [wide]).verdict, "deny", "an override never widens");
  assert.equal(checkOverlay(mine).ok, true);
});

test("chats and research keep their network.egress rules exactly as before, whatever the employee network access says", () => {
  for (const p of [restricted([]), autonomous(), withNetwork(undefined)]) {
    for (const runKind of [undefined, "chat", "research"] as const) {
      const r = (resource: string) => evaluate(policy(p), ask({ action: "network.egress", resource, ...(runKind !== undefined ? { runKind } : {}) }));
      assert.deepEqual(r("api.anthropic.com:443"), { verdict: "allow", matchedRules: ["account:egress-model-api"], reasonCodes: ["RULE_MATCHED"], enforcement: "boundary" }, `${runKind}`);
      assert.deepEqual(r("example.com:443"), { verdict: "deny", matchedRules: [], reasonCodes: ["DEFAULT_DECISION"], enforcement: "boundary" }, `${runKind}`);
    }
  }
  // An assignment's other actions are decided by the rules too.
  assert.deepEqual(evaluate(policy(restricted([])), employee("ws-1", { action: "repository.write" })).reasonCodes, ["RULE_MATCHED"]);
});

test("what cannot be judged is still denied for an employee's run: no policy, no identity, another account", () => {
  assert.deepEqual(evaluate({ constitution: null, overlays: [] }, employee("example.com:443")).reasonCodes, ["NO_PUBLISHED_POLICY"]);
  assert.deepEqual(evaluate(policy(autonomous()), employee("example.com:443", { principalId: null })).reasonCodes, ["NO_VERIFIED_IDENTITY"]);
  assert.deepEqual(evaluate(policy(autonomous()), employee("example.com:443", { accountId: "acc-2" })).reasonCodes, ["ACCOUNT_MISMATCH"]);
});

test("RESTRICTED -> AUTONOMOUS, a wider allow-list, a limit raised or removed are high risk; the reverse is low", () => {
  const r = (b: Constitution, c: Constitution) => impactOf(b, c);
  const field = (i: ReturnType<typeof impactOf>, f: string) => i.obligations.find((o) => o.field === f);

  const restrict = r(autonomous(), restricted(["api.github.com"]));
  assert.deepEqual([restrict.risk, restrict.widened.length, restrict.reasons], ["low", 0, []]);
  assert.deepEqual(field(restrict, "employeeNetwork.mode"), { field: "employeeNetwork.mode", before: "AUTONOMOUS", after: "RESTRICTED", weakened: false });
  assert.ok(restrict.narrowed.some((c) => c.runKind === "assignment" && c.resource === "*:443" && c.before === "allow" && c.after === "deny"));

  const open = r(restricted(["api.github.com"]), autonomous());
  assert.equal(open.risk, "high");
  assert.deepEqual(field(open, "employeeNetwork.mode"), { field: "employeeNetwork.mode", before: "RESTRICTED", after: "AUTONOMOUS", weakened: true });
  assert.deepEqual(open.reasons, ["It lets employees reach any public host: employee network access goes from RESTRICTED to AUTONOMOUS."]);
  assert.ok(open.widened.every((c) => c.runKind === "assignment" && c.action === "network.egress" && c.principalType === "agent"));

  const more = r(restricted(["api.github.com"]), restricted(["api.github.com", "registry.npmjs.org"]));
  assert.deepEqual([more.risk, more.reasons], ["high", ["It lets employees reach hosts their allow-list did not: registry.npmjs.org."]]);
  assert.deepEqual(field(more, "employeeNetwork.allow"), { field: "employeeNetwork.allow", before: "api.github.com", after: "api.github.com, registry.npmjs.org", weakened: true });
  assert.deepEqual(more.widened.map((c) => [c.resource, c.before, c.after, c.environments.length]), [["registry.npmjs.org:443", "deny", "allow", 6], ["registry.npmjs.org:80", "deny", "allow", 6]].sort());
  assert.equal(r(restricted(["a.example.com"]), restricted(["*.example.com"])).risk, "high", "a domain lets in more than one of its hosts");
  for (const [b, c] of [
    [restricted(["api.github.com", "registry.npmjs.org"]), restricted(["api.github.com"])],
    [restricted(["*.example.com"]), restricted(["a.example.com"])],
    [restricted(["*.example.com"]), restricted(["*.a.example.com", "*.example.com"])],
    [autonomous(), autonomous(undefined, ["anything.example.com"])],
  ] as const) {
    const i = r(b, c);
    assert.deepEqual([i.risk, i.widened.length, field(i, "employeeNetwork.allow")?.weakened], ["low", 0, false], `${b.employeeNetwork?.allow.join()} -> ${c.employeeNetwork?.allow.join()}`);
  }

  const raised = r(autonomous({ downloadBytesPerRun: 1000 }), autonomous({ downloadBytesPerRun: 2000 }));
  assert.deepEqual([raised.risk, raised.reasons, field(raised, "employeeNetwork.limits.downloadBytesPerRun")], ["high", ["It raises the employees' limit downloadBytesPerRun from 1000 to 2000."], { field: "employeeNetwork.limits.downloadBytesPerRun", before: "1000", after: "2000", weakened: true }]);
  const removed = r(autonomous({ bandwidthMbpsPerRun: 10, concurrentConnectionsPerRun: 4 }), autonomous({ concurrentConnectionsPerRun: 4 }));
  assert.deepEqual([removed.risk, removed.reasons], ["high", ["It removes the employees' limit bandwidthMbpsPerRun (it was 10)."]]);
  assert.equal(r(autonomous({ connectionsPerMinutePerRun: 60 }), autonomous()).risk, "high", "removing every limit removes each one");
  for (const [b, c] of [
    [autonomous(), autonomous({ downloadBytesPerDay: 10 })],
    [autonomous({ downloadBytesPerDay: 10 }), autonomous({ downloadBytesPerDay: 5 })],
    [autonomous({ connectionsPerMinutePerRun: 60 }), autonomous({ connectionsPerMinutePerRun: 60, concurrentConnectionsPerRun: 8 })],
  ] as const) {
    const i = r(b, c);
    assert.deepEqual([i.risk, i.obligations.every((o) => !o.weakened), i.obligations.length > 0], ["low", true, true]);
  }

  // Not said and said as the default are the same access: nothing changes.
  assert.deepEqual([r(withNetwork(undefined), autonomous()).risk, r(withNetwork(undefined), autonomous()).obligations], ["low", []]);
  assert.deepEqual(employeeNetworkChanges(employeeNetworkOf(withNetwork(undefined)), employeeNetworkOf(autonomous())), []);
});

test("a rule's change is worked out for employees too: removing the deny that held them back is high risk, even when a chat sees no change", () => {
  const block: Rule = { id: "no-tracker", action: "network.egress", resource: "tracker.example:443", effect: "deny" };
  const before = withNetwork({ mode: "AUTONOMOUS", allow: [] }, { rules: [...base().rules, block] });
  const i = impactOf(before, autonomous());
  assert.equal(i.risk, "high");
  assert.deepEqual(i.widened.map((c) => [c.runKind, c.action, c.principalType, c.resource, c.before, c.after]), [["assignment", "network.egress", "agent", "tracker.example:443", "deny", "allow"]]);
  assert.deepEqual(i.reasons, ["It lets employees' assignments reach hosts they could not reach before (network.egress), a sensitive change."]);
  assert.deepEqual(i.rules.map((c) => [c.change, c.id]), [["removed", "no-tracker"]]);
  // The other way it narrows them, and a change that touches nothing about the network asks nothing of them.
  assert.equal(impactOf(autonomous(), before).risk, "low");
  const quiet = impactOf(base(), { ...base(), rules: base().rules.map((x) => (x.id === "workspace-execute" ? { ...x, effect: "deny" as const } : x)) });
  assert.equal(quiet.widened.length + quiet.narrowed.filter((c) => c.runKind === "assignment").length, 0);
});

test("the table carries the employee network access: read, changed and written back, and a policy that did not say it goes on not saying it", () => {
  const t = tableOf(base());
  assert.deepEqual(t.employeeNetwork, { mode: "AUTONOMOUS", allow: [] });
  assert.deepEqual(withTable(base(), t), base());
  const unsaid = withNetwork(undefined);
  assert.equal(Object.hasOwn(withTable(unsaid, tableOf(unsaid)), "employeeNetwork"), false);
  const changed = withTable(unsaid, { ...tableOf(unsaid), employeeNetwork: { mode: "RESTRICTED", allow: ["api.github.com"], limits: { downloadBytesPerDay: 1_000_000 } } });
  assert.deepEqual(changed.employeeNetwork, { mode: "RESTRICTED", allow: ["api.github.com"], limits: { downloadBytesPerDay: 1_000_000 } });
  assert.equal(checkConstitution(changed).ok, true);
  assert.deepEqual(tableOf(changed).employeeNetwork, changed.employeeNetwork);
  assert.deepEqual(withTable(changed, tableOf(changed)), changed);
  // The table's copy is its own: editing it does not edit the document it was read from.
  const read = tableOf(changed);
  read.employeeNetwork.allow.push("x.example.com");
  assert.deepEqual(changed.employeeNetwork?.allow, ["api.github.com"]);
  // Back to AUTONOMOUS with no limit on a policy that had said otherwise: said, as it now is.
  assert.deepEqual(withTable(changed, { ...tableOf(changed), employeeNetwork: { mode: "AUTONOMOUS", allow: [] } }).employeeNetwork, { mode: "AUTONOMOUS", allow: [] });
});

test("an employee's run is its own kind of run, with its own scope; the sign-in channel's word is gone", () => {
  assert.deepEqual([...RUN_KINDS], ["chat", "research", "assignment"]);
  assert.deepEqual(RUN_SCOPES, { chat: "ACCOUNT_WORKSPACE", research: "ACCOUNT_RESEARCH", assignment: "ACCOUNT_EMPLOYEE" });
  assert.ok((ENFORCEMENT_SCOPES as readonly string[]).includes("ACCOUNT_EMPLOYEE"));
  assert.deepEqual([isRunKind("assignment"), isRunKind("chats"), isRunKind(null)], [true, false, false]);
  for (const code of ["EMPLOYEE_NETWORK_AUTONOMOUS", "EMPLOYEE_NETWORK_ALLOWED", "EMPLOYEE_NETWORK_NOT_LISTED", "EMPLOYEE_NETWORK_PORT"]) assert.ok((REASON_CODES as readonly string[]).includes(code), code);
  assert.equal((REASON_CODES as readonly string[]).includes("SIGN_IN_CHANNEL"), false);
});
