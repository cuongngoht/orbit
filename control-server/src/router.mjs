// Which operation a method and a pathname name. It decides nothing else: no
// file is read here, and no rule about skills, servers or tools lives here.
//
// The API is this table and nothing more. A path under /api/ that is not in it
// is a 404, a known path asked with the wrong method is a 405 -- so there is no
// way to reach an operation that is not a row, and there is no row that runs
// an arbitrary command. `mutates` is the column security.mjs asks (the token,
// the origin), `body` says the operation reads a JSON body, and `id` names what
// the path's one parameter is, so a bad encoding is refused in that kind's words.
//
// A path may name more than one thing (a project, then one of its checkouts): `ids` says what each
// capture group IS, in order, so a bad encoding is refused in that kind's words, and `id` stays the
// first for every row that names one. Nothing in a body ever names a project or a checkout.
//
// A connection test and an install are `mutates` although a test keeps little:
// either may start a process or reach the network, and neither is something a
// page nobody authorised should be able to make happen. MCP rows act on Orbit's
// OWN records -- managed, external, policies -- and never write a host's
// configuration; the host's servers are read, and tested on request.
import { agenticHosts } from "./agentic-hosts/read.mjs";
import { account } from "./account.mjs";
import { health } from "./health.mjs";
import { invalid, missing, notAllowed } from "./errors.mjs";
import { refreshExternal, testExternal } from "./mcp/external.mjs";
import { addManaged, approveManaged, removeManagedServer, revokeManaged, setManagedEnabled, setManagedPolicy, setManagedSelection, updateManagedServer } from "./mcp/managed.mjs";
import { deleteRuntime, installManaged, testManaged, testUnsaved } from "./mcp/operate.mjs";
import { setWorkflowExceptions } from "./mcp/policies.mjs";
import { listMcp, listOwned, mcpActivity, mcpCatalog, mcpPolicies, mcpTools, readExternal, readManaged } from "./mcp/read.mjs";
import { resolvePrompt, routerResources } from "./router-inspector/resolve.mjs";
import { listSkills } from "./skills/catalog.mjs";
import { readSkill } from "./skills/read.mjs";
import { removeSkill } from "./skills/remove.mjs";
import { skillResources } from "./skills/resources.mjs";
import { updateSkill } from "./skills/update.mjs";
import { installOne, refreshTool } from "./tools/operate.mjs";
import { publicTool, toolOf, toolsNow } from "./tools/view.mjs";
import { knowledgeView } from "./knowledge/read.mjs";
import { traceTurn, traceTurns, usageAnalytics } from "./trace/read.mjs";
import { clearCredential, createConnection, listConnections, readConnection, removeConnection, setCredential, testConnection, updateConnection } from "./connections/operate.mjs";
import { autonomousQaArtifact, autonomousQaInvestigation, autonomousQaOverview, autonomousQaReport, autonomousQaTests, autonomousQaVersion } from "./autonomous-qa/read.mjs";
import { putAutonomousQaSettings } from "./autonomous-qa/write.mjs";
import { securityCatalog, securityCatalogs } from "./security-catalogs/read.mjs";
import { adoptSecurityCatalog, previewSecurityCatalog, putSecurityEnabled, putSecurityMark, saveSecurityCatalog } from "./security-catalogs/write.mjs";
import { automationOverview, liveSettings, projectAutomation } from "./automation/read.mjs";
import { putAutomation, putLiveSettings, putProjectAutomation } from "./automation/write.mjs";
import { missionHealth } from "./mission-control/health.mjs";
import { generatedSkill, generatedSkills } from "./generated-skills/read.mjs";
import { archiveSkill, moveSkill, revalidateSkill, rollbackSkill } from "./generated-skills/write.mjs";
import { reportParts, reportSettings, reportsOverview } from "./reports/read.mjs";
import { putReportSettings, rollbackExtension, switchPart, verifyExtension } from "./reports/write.mjs";
import { forgetCheckout } from "./projects/forget.mjs";
import { listProjects, readProject } from "./projects/read.mjs";
import { runtimeConnectivity, runtimeProposal, runtimeSettings, runtimeStatus } from "./project-runtime/read.mjs";
import { adoptProposal, checkReach, designEnvironment, discoverRuntime, doctorRuntime, prepareRuntime, putRuntimeSettings, retryReach, startRuntime, stopRuntime, validateRuntime } from "./project-runtime/write.mjs";
import { listSandboxes, revokeTrust, trustDefinition } from "./project-runtime/sandbox.mjs";
import { missionApprovals, missionControl } from "./mission-control/read.mjs";
import { openLogStream } from "./live/log-stream.mjs";
import { openTaskStream, taskActivity, taskPlan } from "./live/task-stream.mjs";
import { listTasks, readTask, taskEvents } from "./tasks/read.mjs";
import { readSandbox, releaseSandbox, sandboxLogs, stopSandbox } from "./tasks/sandbox.mjs";
import { listWorks, readWork } from "./works/read.mjs";
import { approveAction, cancelTask, pauseTask, rejectAction, resumeTask } from "./tasks/write.mjs";

export const API_PREFIX = "/api/";
const SKILL = /^\/api\/v1\/skills\/([^/]+)$/;
const MANAGED = /^\/api\/v1\/mcp\/managed\/([^/]+)$/;
const managedAction = (action) => new RegExp(`^/api/v1/mcp/managed/([^/]+)/${action}$`);
const EXTERNAL = /^\/api\/v1\/mcp\/external\/([^/]+)$/;
const TOOL = /^\/api\/v1\/tools\/([^/]+)$/;
const toolAction = (action) => new RegExp(`^/api/v1/tools/([^/]+)/${action}$`);
const CONNECTION = /^\/api\/v1\/connections\/([^/]+)$/;
const connectionAction = (action) => new RegExp(`^/api/v1/connections/([^/]+)/${action}$`);
const partAction = (action) => new RegExp(`^/api/v1/reports/parts/${action}$`);
const PROJECT = /^\/api\/v1\/projects\/([^/]+)$/;
const runtimePath = (tail = "") => new RegExp(`^/api/v1/projects/([^/]+)/checkouts/([^/]+)/runtime${tail}$`);
const CHECKOUT = ["project", "checkout"];
const PROPOSAL = [...CHECKOUT, "proposal"];
const TARGET = [...CHECKOUT, "target"];
const taskPath = (tail = "") => new RegExp(`^/api/v1/projects/([^/]+)/checkouts/([^/]+)/tasks${tail}$`);
const TASK = [...CHECKOUT, "task"];
const workPath = (tail = "") => new RegExp(`^/api/v1/projects/([^/]+)/checkouts/([^/]+)/works${tail}$`);
const WORK = [...CHECKOUT, "work"];
const APPROVAL = [...TASK, "approval"];
const SESSION = [...TASK, "session"];
const GENERATED = /^\/api\/v1\/projects\/([^/]+)\/generated-skills\/([^/]+)$/;
const generatedAction = (action) => new RegExp(`^/api/v1/projects/([^/]+)/generated-skills/([^/]+)/${action}$`);
const PLAYBOOK = ["project", "skill"];

export const ROUTES = [
  { method: "GET", path: /^\/api\/v1\/agentic-hosts$/, run: ({ ctx }) => agenticHosts(ctx) },
  { method: "GET", path: /^\/api\/v1\/health$/, run: ({ ctx }) => health(ctx) },
  { method: "GET", path: /^\/api\/v1\/account$/, run: ({ ctx }) => account(ctx) },
  { method: "GET", path: /^\/api\/v1\/skills$/, run: ({ ctx }) => ({ skills: listSkills(ctx) }) },
  { method: "GET", path: SKILL, id: "skill", run: ({ ctx, id }) => readSkill(ctx, id) },
  { method: "PUT", path: SKILL, id: "skill", mutates: true, body: true, run: ({ ctx, id, body }) => updateSkill(ctx, id, body) },
  { method: "DELETE", path: SKILL, id: "skill", mutates: true, run: ({ ctx, id }) => removeSkill(ctx, id) },
  { method: "GET", path: /^\/api\/v1\/skills\/([^/]+)\/resources$/, id: "skill", run: ({ ctx, id }) => skillResources(ctx, id) },

  { method: "GET", path: /^\/api\/v1\/router\/resources$/, run: ({ ctx }) => routerResources(ctx) },
  { method: "POST", path: /^\/api\/v1\/router\/resolve$/, body: true, run: ({ ctx, body }) => resolvePrompt(ctx, body) },

  // Projects: every project and checkout Orbit knows on this machine, from the registry -- never a scan --
  // and the runtime of ONE checkout, named in the path by project and checkout both.
  { method: "GET", path: /^\/api\/v1\/projects$/, run: ({ ctx }) => listProjects(ctx) },
  { method: "GET", path: PROJECT, id: "project", run: ({ ctx, id }) => readProject(ctx, id) },
  { method: "POST", path: /^\/api\/v1\/projects\/([^/]+)\/checkouts\/([^/]+)\/forget$/, ids: CHECKOUT, mutates: true, body: true, run: ({ ctx, ids, body }) => forgetCheckout(ctx, ids, body) },
  { method: "GET", path: runtimePath(), ids: CHECKOUT, run: ({ ctx, ids }) => runtimeStatus(ctx, ids) },
  { method: "POST", path: runtimePath("/discover"), ids: CHECKOUT, mutates: true, body: true, run: ({ ctx, ids, body }) => discoverRuntime(ctx, ids, body) },
  { method: "POST", path: runtimePath("/design"), ids: CHECKOUT, mutates: true, body: true, run: ({ ctx, ids, body }) => designEnvironment(ctx, ids, body) },
  { method: "GET", path: runtimePath("/proposals/([^/]+)"), ids: PROPOSAL, run: ({ ctx, ids }) => runtimeProposal(ctx, ids) },
  { method: "POST", path: runtimePath("/proposals/([^/]+)/adopt"), ids: PROPOSAL, mutates: true, body: true, run: ({ ctx, ids, body }) => adoptProposal(ctx, ids, body) },
  { method: "POST", path: runtimePath("/doctor"), ids: CHECKOUT, mutates: true, body: true, run: ({ ctx, ids, body }) => doctorRuntime(ctx, ids, body) },
  { method: "POST", path: runtimePath("/prepare"), ids: CHECKOUT, mutates: true, body: true, run: ({ ctx, ids, body }) => prepareRuntime(ctx, ids, body) },
  { method: "POST", path: runtimePath("/validate"), ids: CHECKOUT, mutates: true, body: true, run: ({ ctx, ids, body }) => validateRuntime(ctx, ids, body) },
  { method: "POST", path: runtimePath("/start"), ids: CHECKOUT, mutates: true, body: true, run: ({ ctx, ids, body }) => startRuntime(ctx, ids, body) },
  { method: "POST", path: runtimePath("/stop"), ids: CHECKOUT, mutates: true, body: true, run: ({ ctx, ids, body }) => stopRuntime(ctx, ids, body) },
  { method: "GET", path: runtimePath("/settings"), ids: CHECKOUT, run: ({ ctx, ids }) => runtimeSettings(ctx, ids) },
  { method: "PUT", path: runtimePath("/settings"), ids: CHECKOUT, mutates: true, body: true, run: ({ ctx, ids, body }) => putRuntimeSettings(ctx, ids, body) },
  { method: "GET", path: runtimePath("/sandboxes"), ids: CHECKOUT, run: ({ ctx, ids }) => listSandboxes(ctx, ids) },
  { method: "POST", path: runtimePath("/sandbox/trust"), ids: CHECKOUT, mutates: true, body: true, run: ({ ctx, ids, body }) => trustDefinition(ctx, ids, body) },
  { method: "POST", path: runtimePath("/sandbox/revoke"), ids: CHECKOUT, mutates: true, body: true, run: ({ ctx, ids, body }) => revokeTrust(ctx, ids, body) },
  { method: "GET", path: runtimePath("/connectivity"), ids: CHECKOUT, run: ({ ctx, ids }) => runtimeConnectivity(ctx, ids) },
  { method: "POST", path: runtimePath("/connectivity/([^/]+)/check"), ids: TARGET, mutates: true, body: true, run: ({ ctx, ids, body }) => checkReach(ctx, ids, body) },
  { method: "POST", path: runtimePath("/connectivity/([^/]+)/retry"), ids: TARGET, mutates: true, body: true, run: ({ ctx, ids, body }) => retryReach(ctx, ids, body) },

  // Mission Control: every task execution on this machine, read off the registry and the task
  // journals -- and one checkout's tasks, named in the path by project and checkout both. A change is
  // a person's decision about ONE task or ONE approval, on the revision the page read; no row runs,
  // stops or deploys anything, and none takes a command.
  { method: "GET", path: /^\/api\/v1\/mission-control$/, run: ({ ctx }) => missionControl(ctx) },
  { method: "GET", path: /^\/api\/v1\/mission-control\/approvals$/, run: ({ ctx }) => missionApprovals(ctx) },
  // Health: what needs a person, read off what Orbit already keeps -- no probe, no detection, no write.
  { method: "GET", path: /^\/api\/v1\/mission-control\/health$/, run: ({ ctx }) => missionHealth(ctx) },
  { method: "GET", path: taskPath(), ids: CHECKOUT, run: ({ ctx, ids }) => listTasks(ctx, ids) },
  { method: "GET", path: taskPath("/([^/]+)"), ids: TASK, run: ({ ctx, ids }) => readTask(ctx, ids) },
  { method: "GET", path: taskPath("/([^/]+)/events"), ids: TASK, run: ({ ctx, ids, query }) => taskEvents(ctx, ids, query) },
  // Orbit Live: the task's lines, its view and its QA activity, merged and resumable from a cursor -- once (`activity`), or
  // as a Server-Sent Events stream. Both are reads: GET, never `mutates`, and nothing they do writes anything.
  { method: "GET", path: taskPath("/([^/]+)/activity"), ids: TASK, run: ({ ctx, ids, query }) => taskActivity(ctx, ids, query) },
  { method: "GET", path: taskPath("/([^/]+)/events/stream"), ids: TASK, stream: true, open: (asked) => openTaskStream(asked) },
  // A coordinated workflow's plan (0.0.4), as every viewer draws it: its steps, revisions, the skill factory's work and
  // every declared playbook's run with its own steps -- the projection a terminal's Plan view is, read, never kept.
  { method: "GET", path: taskPath("/([^/]+)/plan"), ids: TASK, run: ({ ctx, ids }) => taskPlan(ctx, ids) },
  // A task's sandbox is the task's own: found from its journal, read through the runtime, and stopped or
  // released by a person. There is no row that starts, restarts or builds one -- the agent's loop does.
  { method: "GET", path: taskPath("/([^/]+)/sandbox"), ids: TASK, run: ({ ctx, ids }) => readSandbox(ctx, ids) },
  { method: "GET", path: taskPath("/([^/]+)/sandbox/logs/([^/]+)"), ids: SESSION, run: ({ ctx, ids, query }) => sandboxLogs(ctx, ids, query) },
  { method: "GET", path: taskPath("/([^/]+)/sandbox/logs/([^/]+)/stream"), ids: SESSION, stream: true, open: (asked) => openLogStream(asked) },
  { method: "POST", path: taskPath("/([^/]+)/sandbox/stop"), ids: TASK, mutates: true, body: true, run: ({ ctx, ids, body }) => stopSandbox(ctx, ids, body) },
  { method: "POST", path: taskPath("/([^/]+)/sandbox/release"), ids: TASK, mutates: true, body: true, run: ({ ctx, ids, body }) => releaseSandbox(ctx, ids, body) },
  { method: "POST", path: taskPath("/([^/]+)/pause"), ids: TASK, mutates: true, body: true, run: ({ ctx, ids, body }) => pauseTask(ctx, ids, body) },
  { method: "POST", path: taskPath("/([^/]+)/resume"), ids: TASK, mutates: true, body: true, run: ({ ctx, ids, body }) => resumeTask(ctx, ids, body) },
  { method: "POST", path: taskPath("/([^/]+)/cancel"), ids: TASK, mutates: true, body: true, run: ({ ctx, ids, body }) => cancelTask(ctx, ids, body) },
  { method: "POST", path: taskPath("/([^/]+)/approvals/([^/]+)/approve"), ids: APPROVAL, mutates: true, body: true, run: ({ ctx, ids, body }) => approveAction(ctx, ids, body) },
  { method: "POST", path: taskPath("/([^/]+)/approvals/([^/]+)/reject"), ids: APPROVAL, mutates: true, body: true, run: ({ ctx, ids, body }) => rejectAction(ctx, ids, body) },

  // Tracked works (1.8.8): what a person asked for, followed through the host or an autonomous task -- read as the ONE view the
  // terminal and Orbit Live read. Reads only: a work is written by the host's own `cli/track.mjs`, never by a page.
  { method: "GET", path: workPath(), ids: CHECKOUT, run: ({ ctx, ids }) => listWorks(ctx, ids) },
  { method: "GET", path: workPath("/([^/]+)"), ids: WORK, run: ({ ctx, ids }) => readWork(ctx, ids) },

  { method: "GET", path: /^\/api\/v1\/knowledge$/, run: ({ ctx }) => knowledgeView(ctx) },
  { method: "GET", path: /^\/api\/v1\/trace\/turns$/, run: ({ ctx, query }) => traceTurns(ctx, query) },
  { method: "GET", path: /^\/api\/v1\/trace\/turns\/([^/]+)$/, id: "turn", run: ({ ctx, id }) => traceTurn(ctx, id) },
  { method: "GET", path: /^\/api\/v1\/analytics\/usage$/, run: ({ ctx, query }) => usageAnalytics(ctx, query, new Map(listSkills(ctx).map((s) => [s.id, s.allowedTools]))) },

  { method: "GET", path: /^\/api\/v1\/mcp$/, run: ({ ctx }) => listMcp(ctx) },
  { method: "GET", path: /^\/api\/v1\/mcp-catalog$/, run: ({ ctx }) => mcpCatalog(ctx) },
  { method: "GET", path: /^\/api\/v1\/mcp\/policies$/, run: ({ ctx }) => mcpPolicies(ctx) },
  { method: "PUT", path: /^\/api\/v1\/mcp\/policies\/workflows$/, mutates: true, body: true, run: ({ ctx, body }) => setWorkflowExceptions(ctx, body) },
  { method: "GET", path: /^\/api\/v1\/mcp\/activity$/, run: ({ ctx }) => mcpActivity(ctx) },
  { method: "POST", path: /^\/api\/v1\/mcp\/test$/, mutates: true, body: true, run: ({ ctx, body }) => testUnsaved(ctx, body) },

  { method: "GET", path: /^\/api\/v1\/mcp\/managed$/, run: ({ ctx }) => listOwned(ctx, "orbit-managed") },
  { method: "POST", path: /^\/api\/v1\/mcp\/managed$/, mutates: true, body: true, run: ({ ctx, body }) => addManaged(ctx, body) },
  { method: "GET", path: MANAGED, id: "mcp", run: ({ ctx, id }) => readManaged(ctx, id) },
  { method: "PUT", path: MANAGED, id: "mcp", mutates: true, body: true, run: ({ ctx, id, body }) => updateManagedServer(ctx, id, body) },
  { method: "DELETE", path: MANAGED, id: "mcp", mutates: true, run: ({ ctx, id }) => removeManagedServer(ctx, id) },
  { method: "POST", path: managedAction("enable"), id: "mcp", mutates: true, run: ({ ctx, id }) => setManagedEnabled(ctx, id, true) },
  { method: "POST", path: managedAction("disable"), id: "mcp", mutates: true, run: ({ ctx, id }) => setManagedEnabled(ctx, id, false) },
  { method: "PUT", path: managedAction("selection"), id: "mcp", mutates: true, body: true, run: ({ ctx, id, body }) => setManagedSelection(ctx, id, body) },
  { method: "PUT", path: managedAction("policy"), id: "mcp", mutates: true, body: true, run: ({ ctx, id, body }) => setManagedPolicy(ctx, id, body) },
  { method: "POST", path: managedAction("approve"), id: "mcp", mutates: true, body: true, run: ({ ctx, id, body }) => approveManaged(ctx, id, body) },
  { method: "DELETE", path: managedAction("approval"), id: "mcp", mutates: true, run: ({ ctx, id }) => revokeManaged(ctx, id) },
  { method: "POST", path: managedAction("test"), id: "mcp", mutates: true, run: ({ ctx, id }) => testManaged(ctx, id) },
  { method: "POST", path: managedAction("install"), id: "mcp", mutates: true, run: ({ ctx, id }) => installManaged(ctx, id) },
  { method: "DELETE", path: managedAction("runtime"), id: "mcp", mutates: true, run: ({ ctx, id }) => deleteRuntime(ctx, id) },
  { method: "GET", path: managedAction("tools"), id: "mcp", run: ({ ctx, id }) => mcpTools(ctx, id) },

  { method: "GET", path: /^\/api\/v1\/mcp\/external$/, run: ({ ctx }) => listOwned(ctx, "external") },
  { method: "POST", path: /^\/api\/v1\/mcp\/external\/refresh$/, mutates: true, run: ({ ctx }) => refreshExternal(ctx) },
  { method: "GET", path: EXTERNAL, id: "mcp", run: ({ ctx, id }) => readExternal(ctx, id) },
  { method: "POST", path: /^\/api\/v1\/mcp\/external\/([^/]+)\/test$/, id: "mcp", mutates: true, run: ({ ctx, id }) => testExternal(ctx, id) },
  { method: "GET", path: /^\/api\/v1\/mcp\/external\/([^/]+)\/tools$/, id: "mcp", run: ({ ctx, id }) => mcpTools(ctx, id, "external") },


  { method: "GET", path: /^\/api\/v1\/tools$/, run: ({ ctx }) => ({ tools: toolsNow(ctx).map(publicTool) }) },
  { method: "GET", path: TOOL, id: "tool", run: ({ ctx, id }) => toolOf(ctx, id) },
  { method: "POST", path: toolAction("refresh"), id: "tool", mutates: true, run: ({ ctx, id }) => refreshTool(ctx, id) },
  { method: "POST", path: toolAction("install"), id: "tool", mutates: true, run: ({ ctx, id }) => installOne(ctx, id, false) },
  { method: "POST", path: toolAction("update"), id: "tool", mutates: true, run: ({ ctx, id }) => installOne(ctx, id, true) },

  // Connections: machine-wide. A credential arrives once, in PUT …/credential,
  // and is never in an answer.
  { method: "GET", path: /^\/api\/v1\/connections$/, run: ({ ctx }) => listConnections(ctx) },
  { method: "POST", path: /^\/api\/v1\/connections$/, mutates: true, body: true, run: ({ ctx, body }) => createConnection(ctx, body) },
  { method: "GET", path: CONNECTION, id: "connection", run: ({ ctx, id }) => readConnection(ctx, id) },
  { method: "PUT", path: CONNECTION, id: "connection", mutates: true, body: true, run: ({ ctx, id, body }) => updateConnection(ctx, id, body) },
  { method: "DELETE", path: CONNECTION, id: "connection", mutates: true, run: ({ ctx, id }) => removeConnection(ctx, id) },
  { method: "PUT", path: connectionAction("credential"), id: "connection", mutates: true, body: true, run: ({ ctx, id, body }) => setCredential(ctx, id, body) },
  { method: "DELETE", path: connectionAction("credential"), id: "connection", mutates: true, run: ({ ctx, id }) => clearCredential(ctx, id) },
  { method: "POST", path: connectionAction("test"), id: "connection", mutates: true, run: ({ ctx, id }) => testConnection(ctx, id) },

  // PO Reports: the project Control was started from. No row runs a report.
  // Automation: how autonomous a person lets Orbit be -- this machine's document, one project's narrowing, how
  // Live looks -- written ONLY here, and a project's generated playbooks, which a person tests and moves here.
  // A preview of what a prompt would get is the router inspector's (POST router/resolve), never a second route.
  { method: "GET", path: /^\/api\/v1\/automation$/, run: ({ ctx }) => automationOverview(ctx) },
  { method: "PUT", path: /^\/api\/v1\/automation\/settings$/, mutates: true, body: true, run: ({ ctx, body }) => putAutomation(ctx, body) },
  { method: "GET", path: /^\/api\/v1\/live\/settings$/, run: ({ ctx }) => liveSettings(ctx) },
  { method: "PUT", path: /^\/api\/v1\/live\/settings$/, mutates: true, body: true, run: ({ ctx, body }) => putLiveSettings(ctx, body) },
  { method: "GET", path: /^\/api\/v1\/projects\/([^/]+)\/automation$/, id: "project", run: ({ ctx, id }) => projectAutomation(ctx, id) },
  { method: "PUT", path: /^\/api\/v1\/projects\/([^/]+)\/automation\/settings$/, id: "project", mutates: true, body: true, run: ({ ctx, id, body }) => putProjectAutomation(ctx, id, body) },
  { method: "GET", path: /^\/api\/v1\/projects\/([^/]+)\/generated-skills$/, id: "project", run: ({ ctx, id }) => generatedSkills(ctx, id) },
  { method: "GET", path: GENERATED, ids: PLAYBOOK, run: ({ ctx, ids }) => generatedSkill(ctx, ids[0], ids[1]) },
  { method: "POST", path: generatedAction("revalidate"), ids: PLAYBOOK, mutates: true, body: true, run: ({ ctx, ids }) => revalidateSkill(ctx, ids[0], ids[1]) },
  { method: "POST", path: generatedAction("activate"), ids: PLAYBOOK, mutates: true, body: true, run: ({ ctx, ids }) => moveSkill("active")(ctx, ids[0], ids[1]) },
  { method: "POST", path: generatedAction("disable"), ids: PLAYBOOK, mutates: true, body: true, run: ({ ctx, ids }) => moveSkill("disabled")(ctx, ids[0], ids[1]) },
  { method: "POST", path: generatedAction("retire"), ids: PLAYBOOK, mutates: true, body: true, run: ({ ctx, ids }) => moveSkill("retired")(ctx, ids[0], ids[1]) },
  { method: "POST", path: generatedAction("rollback"), ids: PLAYBOOK, mutates: true, body: true, run: ({ ctx, ids, body }) => rollbackSkill(ctx, ids[0], ids[1], body) },
  { method: "POST", path: generatedAction("archive"), ids: PLAYBOOK, mutates: true, body: true, run: ({ ctx, ids }) => archiveSkill(ctx, ids[0], ids[1]) },

  { method: "GET", path: /^\/api\/v1\/autonomous-qa$/, run: ({ ctx }) => autonomousQaOverview(ctx) },
  { method: "PUT", path: /^\/api\/v1\/autonomous-qa\/settings$/, mutates: true, body: true, run: ({ ctx, body }) => putAutonomousQaSettings(ctx, body) },
  { method: "GET", path: /^\/api\/v1\/autonomous-qa\/investigations\/([^/]+)$/, id: "investigation", run: ({ ctx, id }) => autonomousQaInvestigation(ctx, id) },
  { method: "GET", path: /^\/api\/v1\/autonomous-qa\/investigations\/([^/]+)\/report$/, id: "investigation", run: ({ ctx, id }) => autonomousQaReport(ctx, id) },
  { method: "GET", path: /^\/api\/v1\/autonomous-qa\/investigations\/([^/]+)\/tests$/, id: "investigation", run: ({ ctx, id }) => autonomousQaTests(ctx, id) },
  { method: "GET", path: /^\/api\/v1\/autonomous-qa\/investigations\/([^/]+)\/artifacts\/([^/]+)\/([^/]+)$/, ids: ["investigation", "kind", "digest"], run: ({ ctx, ids }) => autonomousQaArtifact(ctx, ids[0], ids[1], ids[2]) },
  { method: "GET", path: /^\/api\/v1\/autonomous-qa\/investigations\/([^/]+)\/versions\/([^/]+)$/, ids: ["investigation", "version"], run: ({ ctx, ids }) => autonomousQaVersion(ctx, ids[0], ids[1]) },

  // Security catalogs (ADR 0040): what Orbit ships, what a person adopted on this machine, and which catalogs the
  // project Control was started from is held to -- read here, and CHANGED only here: a preview (which fetches the
  // https link a person typed, on their action), adopting what was previewed, the editor, enabling, a not-applicable
  // mark. No agent and no terminal reaches any of these: the engine's writers open only for this door.
  { method: "GET", path: /^\/api\/v1\/security\/catalogs$/, run: ({ ctx }) => securityCatalogs(ctx) },
  { method: "GET", path: /^\/api\/v1\/security\/catalogs\/([^/]+)$/, id: "catalog", run: ({ ctx, id }) => securityCatalog(ctx, id) },
  { method: "POST", path: /^\/api\/v1\/security\/catalogs\/preview$/, mutates: true, body: true, run: ({ ctx, body }) => previewSecurityCatalog(ctx, body) },
  { method: "POST", path: /^\/api\/v1\/security\/catalogs\/adopt$/, mutates: true, body: true, run: ({ ctx, body }) => adoptSecurityCatalog(ctx, body) },
  { method: "PUT", path: /^\/api\/v1\/security\/catalogs\/editor$/, mutates: true, body: true, run: ({ ctx, body }) => saveSecurityCatalog(ctx, body) },
  { method: "PUT", path: /^\/api\/v1\/security\/project\/enabled$/, mutates: true, body: true, run: ({ ctx, body }) => putSecurityEnabled(ctx, body) },
  { method: "PUT", path: /^\/api\/v1\/security\/project\/not-applicable$/, mutates: true, body: true, run: ({ ctx, body }) => putSecurityMark(ctx, body) },

  { method: "GET", path: /^\/api\/v1\/reports\/overview$/, run: ({ ctx }) => reportsOverview(ctx) },
  { method: "GET", path: /^\/api\/v1\/reports\/settings$/, run: ({ ctx }) => reportSettings(ctx) },
  { method: "PUT", path: /^\/api\/v1\/reports\/settings$/, mutates: true, body: true, run: ({ ctx, body }) => putReportSettings(ctx, body) },
  { method: "GET", path: /^\/api\/v1\/reports\/parts$/, run: ({ ctx }) => reportParts(ctx) },
  { method: "POST", path: partAction("enable"), mutates: true, body: true, run: ({ ctx, body }) => switchPart(ctx, "enable", body) },
  { method: "POST", path: partAction("disable"), mutates: true, body: true, run: ({ ctx, body }) => switchPart(ctx, "disable", body) },
  { method: "POST", path: partAction("approve"), mutates: true, body: true, run: ({ ctx, body }) => switchPart(ctx, "approve", body) },
  { method: "POST", path: partAction("unapprove"), mutates: true, body: true, run: ({ ctx, body }) => switchPart(ctx, "unapprove", body) },
  { method: "POST", path: partAction("verify"), mutates: true, body: true, run: ({ ctx, body }) => verifyExtension(ctx, body) },
  { method: "POST", path: partAction("rollback"), mutates: true, body: true, run: ({ ctx, body }) => rollbackExtension(ctx, body) },
];

// null when the path is not the API's at all, and the page is asked instead.
export function match(method, pathname) {
  if (!pathname.startsWith(API_PREFIX)) return null;
  const rows = ROUTES.filter((r) => r.path.test(pathname));
  if (!rows.length) throw missing("NOT_FOUND", `no endpoint at ${pathname}`);
  const row = rows.find((r) => r.method === method);
  return row ? found(row, pathname) : wrongMethod(pathname, rows);
}

// Every capture group, decoded in the words of what it names.
function found(row, pathname) {
  const kinds = row.ids ?? [row.id];
  const ids = row.path.exec(pathname).slice(1).map((raw, at) => idOf(raw, kinds[at]));
  return { route: row, id: ids[0], ids };
}

function wrongMethod(pathname, rows) {
  throw notAllowed(`${pathname} answers ${[...new Set(rows.map((r) => r.method))].join(", ")}`);
}

// Decoded here, validated by the operation: `%2e%2e`, `%2F` and friends come
// out of this as the characters they are, and each kind's ID rule refuses them.
function idOf(raw, kind) {
  if (raw === undefined) return undefined;
  try { return decodeURIComponent(raw); }
  catch { throw invalid(`INVALID_${String(kind).toUpperCase()}_ID`, `the ${kind} ID in the path is not valid percent-encoding`); }
}
