import type { ComponentType, ReactNode } from "react";
import type { RouteObject } from "react-router";
import { BotSparkle20Filled, BotSparkle20Regular, BranchFork20Filled, BranchFork20Regular, Bug20Filled, Bug20Regular, ClipboardTaskListLtr20Filled, ClipboardTaskListLtr20Regular, DataBarVertical20Filled, DataBarVertical20Regular, DocumentData20Filled, DocumentData20Regular, FolderOpen20Filled, FolderOpen20Regular, HeartPulse20Filled, HeartPulse20Regular, History20Filled, History20Regular, Key20Filled, Key20Regular, PlugConnected20Filled, PlugConnected20Regular, PuzzlePiece20Filled, PuzzlePiece20Regular, Rocket20Filled, Rocket20Regular, ShieldCheckmark20Filled, ShieldCheckmark20Regular, Timeline20Filled, Timeline20Regular, Wrench20Filled, Wrench20Regular, bundleIcon, type FluentIcon } from "@fluentui/react-icons";
import { AgenticHostsPage } from "../features/agentic-hosts/AgenticHostsPage";
import { ActivityPage } from "../features/activity/ActivityPage";
import { AutomationPage } from "../features/automation/AutomationPage";
import { AUTOMATION_PATH } from "../features/automation/automationWords";
import { AutonomousQaPage } from "../features/autonomous-qa/AutonomousQaPage";
import { AQA_PATH } from "../features/autonomous-qa/aqaWords";
import { AnalyticsPage } from "../features/analytics/AnalyticsPage";
import { ApprovalsPage } from "../features/mission-control/ApprovalsPage";
import { HealthPage } from "../features/mission-control/HealthPage";
import { MissionControlPage } from "../features/mission-control/MissionControlPage";
import { APPROVALS_PATH, HEALTH_PATH, MISSION_PATH, TASK_ROUTE } from "../features/mission-control/missionWords";
import { TaskDetailPage } from "../features/mission-control/TaskDetailPage";
import { ProjectsPage } from "../features/projects/ProjectsPage";
import { WorkPage } from "../features/work/WorkPage";
import { WorksPage } from "../features/work/WorksPage";
import { WORK_PATH, WORK_ROUTE } from "../features/work/workWords";
import { PROJECTS_PATH, RUNTIME_ROUTE } from "../features/projects/projectWords";
import { RuntimePage } from "../features/runtime/RuntimePage";
import { ConnectionDetailPage } from "../features/connections/ConnectionDetailPage";
import { ConnectionsPage } from "../features/connections/ConnectionsPage";
import { CONNECTIONS_PATH } from "../features/connections/connectionWords";
import { ReportsPage } from "../features/reports/ReportsPage";
import { REPORTS_PATH } from "../features/reports/reportWords";
import { AddMcpPage, EditMcpPage } from "../features/mcp/AddMcpPage";
import { ExternalDetailPage } from "../features/mcp/ExternalDetailPage";
import { McpDetailPage } from "../features/mcp/McpDetailPage";
import { McpPage } from "../features/mcp/McpPage";
import { MCP_PATH } from "../features/mcp/paths";
import { RouterPage } from "../features/router/RouterPage";
import { TracePage } from "../features/trace/TracePage";
import { TRACE_PATH } from "../features/trace/traceWords";
import { TurnPage } from "../features/trace/TurnPage";
import { ToolDetailPage } from "../features/tools/ToolDetailPage";
import { ToolsPage } from "../features/tools/ToolsPage";
import { TOOLS_PATH } from "../features/tools/toolWords";
import { SkillsAttentionBadge } from "../features/skills/components/SkillsAttentionBadge";
import { SkillEditorPage } from "../features/skills/SkillEditorPage";
import { SkillsPage } from "../features/skills/SkillsPage";
import { SKILLS_PATH } from "../features/skills/paths";

// Every page the sidebar can reach, as DATA. The sidebar (expanded, rail and
// overlay alike), its section headings, the router, the "which item is
// selected" answer and the home redirect are all read off this table -- so a
// new feature is one row here and a folder under features/, and nothing else
// in app/ changes.
//
// `icon` is a bundled Regular/Filled pair: the sidebar shows the filled one for
// the page you are on, which is how Fluent marks selection beyond color alone.
export type Group = "Mission Control" | "Reports" | "Resources" | "Advanced";

export interface Destination {
  id: string;
  path: string;
  label: string;
  /** The sidebar section it is listed under, in table order. */
  group: Group;
  icon: FluentIcon;
  /** A small signal next to the label, e.g. how many items need attention. */
  badge?: ComponentType;
  element: ReactNode;
  /** Pages below this one that the sidebar does not list, e.g. `/skills/:id`. */
  children?: RouteObject[];
}

export const DESTINATIONS: Destination[] = [
  {
    id: "mission-control",
    path: MISSION_PATH,
    label: "Tasks",
    group: "Mission Control",
    icon: bundleIcon(Rocket20Filled, Rocket20Regular),
    element: <MissionControlPage />,
    children: [
      { path: TASK_ROUTE, element: <TaskDetailPage /> },
    ],
  },
  {
    id: "approvals",
    path: APPROVALS_PATH,
    label: "Approvals",
    group: "Mission Control",
    icon: bundleIcon(ShieldCheckmark20Filled, ShieldCheckmark20Regular),
    element: <ApprovalsPage />,
  },
  {
    id: "health",
    path: HEALTH_PATH,
    label: "Health",
    group: "Mission Control",
    icon: bundleIcon(HeartPulse20Filled, HeartPulse20Regular),
    element: <HealthPage />,
  },
  {
    id: "reports",
    path: REPORTS_PATH,
    label: "PO Reports",
    group: "Reports",
    icon: bundleIcon(DocumentData20Filled, DocumentData20Regular),
    element: <ReportsPage />,
    children: [
      { path: "settings", element: <ReportsPage tab="settings" /> },
      { path: "connection", element: <ReportsPage tab="connection" /> },
      { path: "sections", element: <ReportsPage tab="sections" /> },
      { path: "extensions", element: <ReportsPage tab="extensions" /> },
    ],
  },
  {
    id: "autonomous-qa",
    path: AQA_PATH,
    label: "Autonomous QA",
    group: "Reports",
    icon: bundleIcon(Bug20Filled, Bug20Regular),
    element: <AutonomousQaPage />,
  },
  { id: "agentic-hosts", path: "/agentic-hosts", label: "Agentic Hosts", group: "Resources", icon: bundleIcon(PlugConnected20Filled, PlugConnected20Regular), element: <AgenticHostsPage /> },
  {
    id: "skills",
    path: SKILLS_PATH,
    label: "Skills",
    group: "Resources",
    icon: bundleIcon(PuzzlePiece20Filled, PuzzlePiece20Regular),
    badge: SkillsAttentionBadge,
    element: <SkillsPage />,
    children: [{ path: ":id", element: <SkillEditorPage /> }],
  },
  {
    id: "mcp",
    path: MCP_PATH,
    label: "MCP",
    group: "Resources",
    icon: bundleIcon(PlugConnected20Filled, PlugConnected20Regular),
    element: <McpPage />,
    children: [
      { path: "external", element: <McpPage tab="external" /> },
      { path: "external/:id", element: <ExternalDetailPage /> },
      { path: "catalog", element: <McpPage tab="catalog" /> },
      { path: "policies", element: <McpPage tab="policies" /> },
      { path: "new", element: <AddMcpPage /> },
      { path: "managed/:id", element: <McpDetailPage /> },
      { path: "managed/:id/edit", element: <EditMcpPage /> },
    ],
  },
  {
    id: "tools",
    path: TOOLS_PATH,
    label: "Tools",
    group: "Resources",
    icon: bundleIcon(Wrench20Filled, Wrench20Regular),
    element: <ToolsPage />,
    children: [{ path: ":id", element: <ToolDetailPage /> }],
  },
  {
    id: "connections",
    path: CONNECTIONS_PATH,
    label: "Connections",
    group: "Resources",
    icon: bundleIcon(Key20Filled, Key20Regular),
    element: <ConnectionsPage />,
    children: [{ path: ":id", element: <ConnectionDetailPage /> }],
  },
  {
    id: "analytics",
    path: "/analytics",
    label: "Analytics",
    group: "Advanced",
    icon: bundleIcon(DataBarVertical20Filled, DataBarVertical20Regular),
    element: <AnalyticsPage />,
  },
  {
    id: "work",
    path: WORK_PATH,
    label: "Work",
    group: "Advanced",
    icon: bundleIcon(ClipboardTaskListLtr20Filled, ClipboardTaskListLtr20Regular),
    element: <WorksPage />,
    children: [{ path: WORK_ROUTE, element: <WorkPage /> }],
  },
  {
    id: "projects",
    path: PROJECTS_PATH,
    label: "Projects",
    group: "Advanced",
    icon: bundleIcon(FolderOpen20Filled, FolderOpen20Regular),
    element: <ProjectsPage />,
    children: [{ path: RUNTIME_ROUTE, element: <RuntimePage /> }],
  },
  {
    id: "automation",
    path: AUTOMATION_PATH,
    label: "Automation limits",
    group: "Advanced",
    icon: bundleIcon(BotSparkle20Filled, BotSparkle20Regular),
    element: <AutomationPage />,
  },
  {
    id: "router",
    path: "/router",
    label: "Router",
    group: "Advanced",
    icon: bundleIcon(BranchFork20Filled, BranchFork20Regular),
    element: <RouterPage />,
  },
  {
    id: "activity",
    path: "/activity",
    label: "Activity",
    group: "Advanced",
    icon: bundleIcon(History20Filled, History20Regular),
    element: <ActivityPage />,
  },
  {
    id: "trace",
    path: TRACE_PATH,
    label: "Trace",
    group: "Advanced",
    icon: bundleIcon(Timeline20Filled, Timeline20Regular),
    element: <TracePage />,
    children: [{ path: ":id", element: <TurnPage /> }],
  },
];

// The sidebar's sections, in the order their first page appears in the table.
export const GROUPS: Group[] = [...new Set(DESTINATIONS.map((d) => d.group))];

export const HOME = DESTINATIONS[0].path;

// `/skills/orbit-help` is still "Skills" in the sidebar, and `/mission-control/health` is Health, not Tasks: the
// destination whose path matches the most of the address wins.
const matches = (pathname: string, d: Destination) => pathname === d.path || pathname.startsWith(`${d.path}/`);

export const destinationAt = (pathname: string) => DESTINATIONS.filter((d) => matches(pathname, d)).sort((a, b) => b.path.length - a.path.length)[0];
