// The ONE door from the Control Server into Orbit core, and into the plugin's
// own bindings beside it.
//
// The Control Server sits BESIDE the engine, not inside it: nothing under src/
// knows it exists, and nothing here edits a core module. What it borrows is the
// answers core already gives and that a second copy would drift from:
//
//   contained / physical  containment checked lexically AND through symlinks
//   storeBase             where the machine store lives (ORBIT_STORE_DIR, or the
//                         home default), refusing a path inside a repository
//   writeAtomic / realIo  replace a file or leave the old one, retrying the
//                         rename Windows refuses while an indexer holds it
//   engineVersion         which engine this checkout IS
//
//   the resource manager  the Effective Resource Registry, the router that
//                         reads it and its derived views, MCP state v2 and the
//                         operations a person may perform on it, the managed
//                         runtime installers, tool reconciliation -- the SAME
//                         modules the prompt router's hook composes, so Control
//                         and the router can never disagree about what is usable
//   realWorld             the real host (read-only), Process port, detectors
//                         and installers, bound once (skills/orbit-control/world.mjs)
//   project knowledge     the engine's read-only summary of what it understands
//                         about the project (src/knowledge/summary.mjs)
//   the session trail     the log the hooks append to, and the projections over
//                         it -- the decision trace and the usage analytics
//                         (src/trace/), the same ones `cli/trace.mjs` prints
//   a world's connections the manager a person's sign-in goes through, bound once
//                         per world (`connectionsOf`, below)
//
// Every other file in control-server/ imports from here and never from
// ../../src or ../../skills directly -- test/server.test.mjs asserts it -- so
// the coupling is one list.
import { connectionsOver } from "../../skills/orbit-report/bind.mjs";

export { contained, physical } from "../../src/project/boundary.mjs";
export { projectStoreRoot, storeBase } from "../../src/project/repository.mjs";
export { writeAtomic } from "../../src/store/atomic.mjs";
export { realIo } from "../../src/store/io.mjs";
export { guardedIo } from "../../src/store/guard.mjs";
export { engineVersion } from "../../src/version.mjs";
export { Blocked, Refused } from "../../src/errors.mjs";

export { effectiveResourcesOf, mcpCatalogAt, mcpInvokeContext, mcpOf, mcpStateOf, toolCatalogAt, toolsOf } from "../../src/resources/compose.mjs";
export { FAMILIES } from "../../src/resources/model.mjs";
export { everyResource, summarize } from "../../src/resources/registry.mjs";
export { observeMcp } from "../../src/resources/observe.mjs";
export { route, ROUTE_DECISION_VERSION } from "../../src/routing/resolve.mjs";
export { formatDecision } from "../../src/routing/format.mjs";
export { consumersOf, explainNeeds } from "../../src/routing/explain.mjs";
export { TEXT_LIMIT } from "../../src/routing/terms.mjs";
export { recentActivity } from "../../src/mcp/activity.mjs";
export { probeManaged } from "../../src/mcp/connect.mjs";
export { keyOf } from "../../src/mcp/identity.mjs";
export { installMcp, removeRuntime } from "../../src/mcp/install.mjs";
export { listManagedTools } from "../../src/mcp/invoke.mjs";
export { managedProblems, managedRecord, publicDefinition, SELECTIONS } from "../../src/mcp/managed.mjs";
export { addCustom, addFromCatalog, approve, APPROVAL_MINUTES, recordCheck, removeManaged, revokeApproval, setEnabled, setPolicy, setSelection, setWorkflows, updateManaged } from "../../src/mcp/manage.mjs";
export { envSecrets } from "../../src/secrets.mjs";
export { VERDICTS } from "../../src/policy.mjs";
export { createToolState, withTool } from "../../src/tools/state.mjs";
export { detectTool } from "../../src/tools/detect.mjs";
export { installTool } from "../../src/tools/install.mjs";
export { installContext } from "../../src/tools/ensure.mjs";
export { projectCapabilities } from "../../src/extensions/capabilities.mjs";
export { projectKnowledge } from "../../src/knowledge/summary.mjs";
export { traceLog } from "../../src/trace/log.mjs";
export { suggestedEntries, turnOf, turnsOf } from "../../src/trace/projections/turns.mjs";
export { usageOf } from "../../src/trace/projections/usage.mjs";
export { loadProject } from "../../src/project/index.mjs";
export { realWorld } from "../../skills/orbit-control/world.mjs";

// Project reports and the connections their sources are read through: the
// pack's binding (the same one cli/project-report.mjs uses), the settings,
// the runs, and the one extension lifecycle.
export { boundReport, probeFor, publicProviders, reportStore, SOURCES } from "../../skills/orbit-report/bind.mjs";
export { providers as providerDescriptors } from "../../skills/orbit-report/pack.mjs";
export { connectionProblems } from "../../src/connections/model.mjs";
export { AuthBlocked, excerpt } from "../../src/connections/auth-errors.mjs";

// The connections manager of a WORLD, bound once and kept as long as that world is -- the one thing here that is more than
// a re-export. What signs a connection in (src/connections/auth.mjs) shares ONE sign-in and ONE token request between every
// caller that asks while one is running, and that sharing lives in the manager's auth: a manager made for each request
// would let two requests each open a browser. A token it holds is in memory and goes nowhere else. A world may hand in the
// manager it already bound (`world.connections`: how a test gives it a fake auth); otherwise it is bound over the world's
// rooms, secret port and environment, which is the environment a sign-in tool is started with.
const managers = new WeakMap();

export function connectionsOf(world) {
  if (!managers.has(world)) managers.set(world, world.connections ?? connectionsOver(world.rooms, world.secrets, world.env));
  return managers.get(world);
}
export { checkReport } from "../../skills/orbit-report/extend.mjs";
export { standardParts, standardSections } from "../../skills/orbit-report/pack.mjs";
export { readSettings, STALE_REVISION, writeSettings } from "../../src/project-report/settings.mjs";
export { reportProject } from "../../src/project-report/context.mjs";
// Autonomous QA: the settings a person approves, the investigations the
// engine kept, and the page each renders -- read and written through the
// same modules cli/autonomous-qa.mjs uses, never a copy.
export { createInvestigations, MODES as AQA_MODES, modelOf as investigationModel, readSettings as readAqaSettings, STALE_REVISION as AQA_STALE_REVISION, summaries as investigationSummaries, writeSettings as writeAqaSettings } from "../../src/investigation/index.mjs";
export { blockers as aqaBlockers } from "../../src/investigation/gates.mjs";
export { testsOf as investigationTests } from "../../src/investigation/model.mjs";
// Security catalogs (0.1.0, ADR 0040): the catalogs a person adopts on this machine and enables for a project, read and
// written through the SAME modules cli/security-audit.mjs runs -- and a write opens only for Control's door.
export { COMMANDS as SECURITY_COMMANDS, stateOf as securityState } from "../../src/qa/security/index.mjs";
export { catalogDigest, parsedCatalog, previewOf } from "../../src/qa/security/catalog.mjs";
export { adoptCatalog, enableCatalogs, markControl, securityRooms } from "../../src/qa/security/store.mjs";
export { investigationHtml, investigationJson } from "../../src/report/investigation.mjs";
export { componentOn } from "../../src/project/components.mjs";
export { planReport, reportStatus } from "../../src/project-report/index.mjs";
export { latestRender, readRun } from "../../src/project-report/runs.mjs";
export { registeredState } from "../../src/extensions/fingerprint.mjs";
export { rollbackTool, verifyTool, versionsOf } from "../../src/extensions/lifecycle.mjs";
export { createQcTools } from "../../src/extensions/store.mjs";
export { createProcess } from "../../src/process/index.mjs";

export { hostsView } from "../../src/host/model.mjs";
export { catalogFile, readCatalog } from "../../src/catalog.mjs";
export { optionEnvironment } from "../../skills/orbit-learn/hosts/settings.mjs";

// Runtime: which projects and checkouts Orbit knows on this machine, and one checkout's runtime --
// bound by the SAME binding cli/runtime.mjs uses, so what Control shows and what the CLI prints are
// one answer. The registry lists what was BOUND; nothing here scans a directory.
export { CHECKOUT_PRESENT, createRegistry } from "../../src/store/registry.mjs";
export { bindRuntime, bindSandbox } from "../../skills/orbit-runtime/bind.mjs";
export { COMMANDS as RUNTIME_COMMANDS, keepSettings as keepRuntimeSettings } from "../../src/runtime/index.mjs";
export { STALE_PROPOSAL } from "../../src/runtime/proposal.mjs";
export { TARGET_UNKNOWN } from "../../src/runtime/connectivity/check.mjs";
export { ADOPT_UNVERIFIED } from "../../src/runtime/writer.mjs";

// Mission Control: task executions, machine-wide and per checkout. The task subject is read and
// governed through the SAME command table cli/task.mjs runs, so a person's decision in Control and
// one relayed with --human are one door; the machine view is a projection over the registry.
export { COMMANDS as TASK_COMMANDS } from "../../src/task/index.mjs";
export { CONFLICT_CODES as TASK_CONFLICTS, MISSING_CODES as TASK_MISSING } from "../../src/task/vocab.mjs";
export { localDayStart, machineApprovals, machineView } from "../../src/task/machine.mjs";
export { createTasks, journalLine as taskJournalLine } from "../../src/task/store.mjs";
export { recentOf as recentTasks } from "../../src/task/recent.mjs";
// Orbit Live: a follower over a journal, a task as a live page reads it, and what an investigation's
// lines say as live QA activity. Read-only, every one of them.
export { createFollower } from "../../src/store/follow.mjs";
export { createTaskLive, fingerprintOf, liveEvent, LIVE_VERSION, TASK_SOURCE } from "../../src/task/live.mjs";
export { journalLine as investigationJournalLine } from "../../src/investigation/store.mjs";
export { activityOf, ACTIVITY_VERSION } from "../../src/investigation/activity.mjs";
export { investigationsOf, MAX_FOLLOWED, stampOf } from "../../src/investigation/discover.mjs";
export { QA_SOURCE } from "../../src/investigation/live.mjs";
// What a running check was observed doing (1.8.5, ADR 0020): its file and its projection, as the live core reads it.
export { ACTIVITY_SOURCE } from "../../src/orchestration/activity/source.mjs";
// The live core every viewer shares (ADR 0016): a page here, a terminal's `live watch`, the status line.
// Control keeps only the transport -- Server-Sent Events, its routes, a context named by the path.
export { collectFeed, openFeed } from "../../src/live/feed.mjs";
// A coordinated workflow's plan and a declared playbook's workflow (0.0.4) as the live core reads them, and the ONE
// projection of a plan every viewer draws -- the page's plan card and a terminal's Plan view are this function.
export { PLAN_SOURCE } from "../../src/automation/source.mjs";
export { SKILL_SOURCE } from "../../src/skill-factory/source.mjs";
export { IMPROVEMENT_SOURCE } from "../../src/improvement/live.mjs";
// Autonomous self-improvement (0.3.0, ADR 0045): a campaign's one projection, its fold, the nine metrics, a person's
// three decisions (Control's door), the improvement room -- and Satellite's own binding for a campaign about a role.
export { createImprovement } from "../../src/improvement/store.mjs";
export { campaignRow, campaignView, opportunityView } from "../../src/improvement/views.mjs";
export { modelOf as improvementModel, phaseOf as improvementPhase } from "../../src/improvement/model.mjs";
export { phasesOf as improvementPhases, qualityOf as improvementQuality } from "../../src/improvement/metrics.mjs";
export { person as improvementDecision } from "../../src/improvement/loop.mjs";
export { eventsOf as improvementEvents } from "../../src/improvement/live.mjs";
export { improvementSubject } from "../../skills/orbit-help/factory.mjs";
export { improvementPorts as satelliteImprovementPorts } from "../../satellite/cli/improvement.mjs";
export { planViewOf, skillRunsOf } from "../../src/live/plan.mjs";
export { createFollowers, POLL_MS } from "../../src/live/followers.mjs";
export { tickSubject } from "../../src/live/subjects.mjs";
export { CURSOR, formatCursor, formatOffset, MAX_CURSOR, parseCursor, parseOffset, zeroCursor } from "../../src/live/cursor.mjs";
export { claimedEnvironment, isRefusal, NO_SANDBOX, sessionRefusal, witnessedBy } from "../../src/live/logs.mjs";
// Unified work tracking (1.8.8): a tracked work, read as the ONE view the terminal (`cli/track.mjs`) and Orbit Live also read.
// Control only reads it: the work store, the list, the assembly of the view and the working-set port it joins, with the live core's
// session fold the view's activity is made of. Nothing here writes a work.
export { createWorks } from "../../src/work/store.mjs";
export { readView as readWorkView } from "../../src/work/track/read.mjs";
export { listOf as listTrackedWorks, ownedBy as workOwnedBy, scanOf as scanWorks } from "../../src/work/track/resolve.mjs";
export { trackOf as trackedFold } from "../../src/work/track/fold.mjs";
export { workingSetOf, workingSetRoom } from "../../src/work/track/tail.mjs";
export { sessionActivityOf, sessionLinesOf } from "../../src/live/session.mjs";
export { CHECKS as WORKING_SET_CHECKS } from "../../src/engineering/working-set/collect.mjs";
// A SKILL.md, read and held to the contract the shipped skills hold to: the engine's one parse and one
// table, which Orbit Control's skill editor and the skill factory both use.
export { frontmatter } from "../../src/skill-factory/frontmatter.mjs";
export { metadataOf, problemsOf } from "../../src/skill-factory/instruction.mjs";
// Automation: how autonomous a person lets Orbit be (machine and project documents, narrowed, written only
// through this door), the policy matrix those settings give, and how Live looks -- and the skill factory's
// generated playbooks, which a person tests, activates, disables, retires, rolls back and archives here.
export { AUTOMATION_DOOR, AUTOMATION_SETTINGS_INVALID, FIELDS as AUTOMATION_FIELDS, FIXED as AUTOMATION_FIXED, FIELDS as AUTOMATION_SETTABLE, effectiveOf, readAutomation, writeAutomation } from "../../src/automation/settings.mjs";
export { ACTION_CLASSES, matrixOf } from "../../src/automation/policy.mjs";
export { FIELDS as LIVE_FIELDS, readLive, writeLive } from "../../src/live/settings.mjs";
export { factoryPort } from "../../skills/orbit-help/factory.mjs";
export { resolved } from "../../src/knowledge/verify.mjs";
export { owns as ownsStatusLine, target as statusLineTarget } from "../../skills/orbit-learn/hosts/claude-statusline.mjs";
