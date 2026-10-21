// Automation as control-server answers it, in memory. Like the real server, autonomy is the default and no field
// is a switch that turns it on; a save names the revision it read and a stale one is a 409; a retired switch is
// refused; a fixed field is refused; a project only narrows the machine; a restriction a person kept from before
// is shown, narrows, and is lifted only on the revision read; and a generated playbook whose files changed cannot
// be activated.
import type { GeneratedSkillDetail, AutomationOverview, FieldRow, GeneratedSkill, MatrixRow, SettingValue, SettingsTree } from "../features/automation/automation.types";
import { reply, type Call } from "./fakeServer";

const FIELDS: FieldRow[] = [
  { path: "trigger.arbitraryPrompt", type: "boolean", values: null, min: null, max: null, default: true, narrow: "and", say: "the prompt router may say a workflow would fit" },
  { path: "skillFactory.maxSkillsPerTask", type: "integer", values: null, min: 0, max: 10, default: 2, narrow: "min", say: "playbooks one task may generate" },
  { path: "execution.maxAttempts", type: "integer", values: null, min: 1, max: 20, default: 4, narrow: "min", say: "plan revisions a workflow may make" },
  { path: "live.display", type: "enum", values: ["off", "compact", "full", "auto"], min: null, max: null, default: "auto", narrow: "order", say: "how a workflow says to watch it" },
];

const ORDER: Record<string, string[]> = { "live.display": ["off", "compact", "full", "auto"] };

const isTree = (v: SettingValue | SettingsTree | undefined): v is SettingsTree => typeof v === "object" && v !== null;

function at(tree: SettingsTree, path: string): SettingValue | undefined {
  const found = path.split(".").reduce<SettingValue | SettingsTree | undefined>((node, k) => (isTree(node) ? node[k] : undefined), tree);
  return isTree(found) ? undefined : found;
}

function merged(base: SettingsTree, changes: SettingsTree): SettingsTree {
  const out: SettingsTree = { ...base };
  for (const [k, v] of Object.entries(changes)) {
    const prior = out[k];
    out[k] = isTree(v) ? merged(isTree(prior) ? prior : {}, v) : v;
  }
  return out;
}

function pathTree(path: string, value: SettingValue): SettingsTree {
  const keys = path.split(".");
  const last = keys.pop() ?? path;
  return keys.reduceRight<SettingsTree>((child, k) => ({ [k]: child }), { [last]: value });
}

const valued = (tree: SettingsTree): SettingsTree => FIELDS.reduce<SettingsTree>((acc, f) => merged(acc, pathTree(f.path, at(tree, f.path) ?? f.default)), {});

const stricter = (path: string, narrow: string, p: SettingValue, m: SettingValue): boolean => {
  const order = ORDER[path];
  if (order) return order.indexOf(String(p)) < order.indexOf(String(m));
  return narrow === "and" ? p === false : Number(p) < Number(m);
};

function narrowed(machine: SettingsTree, project: SettingsTree | null) {
  const fields: Record<string, { value: SettingValue; by: string }> = {};
  for (const f of FIELDS) {
    const m = at(machine, f.path);
    const p = project ? at(project, f.path) : undefined;
    const wins = p !== undefined && (m === undefined || stricter(f.path, f.narrow, p, m));
    fields[f.path] = wins ? { value: p ?? null, by: "project" } : m !== undefined ? { value: m, by: "machine" } : { value: f.default, by: "default" };
  }
  const values = Object.entries(fields).reduce<SettingsTree>((acc, [path, f]) => merged(acc, pathTree(path, f.value)), {});
  const matrix: MatrixRow[] = [
    { id: "dispatch-skill", verdict: "allow", default: "allow", narrowedBy: null, say: "hand a step to an existing skill" },
    { id: "generate-instruction-skill", verdict: "allow", default: "allow", narrowedBy: null, say: "generate, verify and register an instruction-only project playbook" },
    { id: "push-merge-deploy", verdict: "deny", default: "deny", narrowedBy: null, say: "push, merge or deploy — never" },
  ];
  return { values, fields, matrix };
}

const SKILL: GeneratedSkill = { id: "release-checklist-verification", version: "0.1.0", digest: "ab12cd34".repeat(8), pin: "release-checklist-verification:0.1.0:ab12cd34", status: "active", scope: "project", provides: ["release.checklist.verification"], needs: ["project.context"], workflow: "orbit-help", sourceTask: "tsk-0123456789ab", summary: "release.checklist.verification — verify the release checklist", quarantined: false, offered: true, at: "2026-10-08T10:00:00.000Z" };

const MOVED = new Map<string, GeneratedSkill["status"]>([["activate", "active"], ["disable", "disabled"], ["retire", "retired"]]);

interface Body {
  settings: SettingsTree;
  revision: string | null;
}

const isBody = (v: unknown): v is Body => typeof v === "object" && v !== null && "settings" in v && "revision" in v;



export function fakeAutomation() {
  const state = { machine: {} as SettingsTree, machineRev: null as string | null, project: {} as SettingsTree, projectRev: null as string | null, n: 0, skill: { ...SKILL }, moves: [] as string[], declared: null as Pick<GeneratedSkillDetail, "workflow" | "runs" | "review"> | null };
  const doc = (set: SettingsTree, revision: string | null) => ({ settings: valued(set), set, revision, exists: revision !== null, unreadable: null, updatedAt: revision ? "2026-10-08T10:00:00.000Z" : null });
  const overview = (): AutomationOverview => ({ version: 1, fields: FIELDS, fixed: { "skillFactory.allowExecutableCode": false, "skillFactory.requireValidation": true }, machine: doc(state.machine, state.machineRev), effective: narrowed(state.machine, null), live: { fields: [{ path: "statusLine.lines", type: "integer", values: null, min: 1, max: 3, default: 2, narrow: "min", say: "lines the status line may use" }], settings: { statusLine: { lines: 2 } }, revision: null, exists: false }, readiness: [{ id: "claude", name: "Claude Code", agents: true, promptRouter: true, statusLine: "not-installed" }, { id: "codex", name: "Codex", agents: false, promptRouter: true, statusLine: "unavailable" }, { id: "antigravity", name: "Antigravity CLI", agents: false, promptRouter: false, statusLine: "unavailable" }] });
  const projectView = () => ({ version: 1, project: "repo-shop", machine: doc(state.machine, state.machineRev), settings: doc(state.project, state.projectRev), effective: narrowed(state.machine, state.project) });
  const save = (call: Call, scope: "machine" | "project"): Response => {
    if (!isBody(call.body)) return reply(400, { error: { code: "AUTOMATION_SETTINGS_INVALID", message: "send { settings, revision }" } });
    if (call.body.revision !== (scope === "machine" ? state.machineRev : state.projectRev)) return reply(409, { error: { code: "STALE_REVISION", message: "the automation settings changed since they were read" } });
    if (at(call.body.settings, "skillFactory.allowExecutableCode") !== undefined) return reply(400, { error: { code: "AUTOMATION_SETTINGS_INVALID", message: "skillFactory.allowExecutableCode is fixed at false in this release" } });
    const rev = `rev-${++state.n}`;
    if (scope === "machine") Object.assign(state, { machine: merged(state.machine, call.body.settings), machineRev: rev });
    else Object.assign(state, { project: merged(state.project, call.body.settings), projectRev: rev });
    return reply(200, { saved: scope === "machine" ? overview() : projectView() });
  };
  const move = (action: string): Response => {
    state.moves.push(action);
    if (action === "activate" && state.skill.quarantined) return reply(409, { error: { code: "SF_QUARANTINED", message: "its files changed after they were verified" } });
    const status = MOVED.get(action);
    if (status) state.skill = { ...state.skill, status, offered: status === "active" };
    if (action === "archive") state.skill = { ...state.skill, archived: true, status: "retired", offered: false };
    if (action === "revalidate") return reply(200, { verdict: { id: state.skill.id, intact: !state.skill.quarantined, ok: true, findings: [] } });
    return reply(200, { result: { id: state.skill.id }, skill: state.skill, playbook: { pin: state.skill.pin, status: state.skill.status, files: [] } });
  };
  const handle = (call: Call): Response | null => {
    if (call.path === "/api/v1/automation") return reply(200, overview());
    if (call.path === "/api/v1/automation/settings" && call.method === "PUT") return save(call, "machine");
    if (call.path === "/api/v1/projects") return reply(200, { projects: [{ key: "repo-shop", name: "shop", checkouts: [] }] });
    if (call.path === "/api/v1/projects/repo-shop/automation") return reply(200, projectView());
    if (call.path === "/api/v1/projects/repo-shop/automation/settings" && call.method === "PUT") return save(call, "project");
    if (call.path === "/api/v1/projects/repo-shop/generated-skills") return reply(200, { version: 1, project: "repo-shop", skills: [state.skill], drafts: [] });
    if (call.path === `/api/v1/projects/repo-shop/generated-skills/${SKILL.id}`) return reply(200, { version: 1, project: "repo-shop", skill: state.skill, playbook: { pin: state.skill.pin, status: state.skill.status, files: [{ name: "SKILL.md", text: "# Release checklist verification\n\nRead the checklist." }] }, ...(state.declared ?? {}) });
    const action = new RegExp(`^/api/v1/projects/repo-shop/generated-skills/${SKILL.id}/([a-z]+)$`).exec(call.path);
    if (action && call.method === "POST") return move(action[1] ?? "");
    return null;
  };
  return { handle, state };
}

/** A declared playbook's page as the server answers it (0.0.4): its workflow, one run that answered within its contract
 * and proved nothing past it, and the review that run answers. */
export const declaredDetail = (): Pick<GeneratedSkillDetail, "workflow" | "runs" | "review"> => ({
  workflow: { pin: SKILL.pin, id: SKILL.id, version: "0.1.0", status: "active", provides: SKILL.provides, bounds: { maxCalls: 8 }, steps: [{ id: "evidence", capability: "release.evidence.read", tool: null, after: [], required: true, evidence: "report", approval: "none", retries: 0 }, { id: "notes", capability: "release.notes.search", tool: "search", after: ["evidence"], required: true, evidence: "owner-record", approval: "owner", retries: 1 }] },
  runs: [{ task: "tsk-0123456789ab", run: "srun-0123456789ab", pin: SKILL.pin, word: "REPORTED", at: "2026-10-20T10:00:00.000Z", session: "s-1", steps: [{ id: "evidence", word: "CONTRACT_MET", required: true, calls: 1, retries: 0, waiting: null }, { id: "notes", word: "CONTRACT_MET", required: true, calls: 1, retries: 0, waiting: null }] }],
  review: { id: SKILL.id, versions: [{ pin: SKILL.pin, version: "0.1.0", status: "active", holds: true, runs: 1, verified: 0, reported: 1, failed: 0, blocked: 0 }], questions: [{ id: "EVIDENCE", ask: "Is what it did proven by an owner's record?", answer: "no", because: "1 of 1 run(s) were reported" }], reliability: { word: "INSUFFICIENT", runs: 1, because: "1 run(s) in 1 session(s) — one session's success is an observation, never a rule" }, proposal: { successor: false, because: "nothing its runs show asks for a new version", writes: "nothing" } },
});
