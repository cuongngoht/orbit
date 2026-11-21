// SETTINGS → SKILLS and PLUGINS: what Claude Code is given to work with. Orbit's own (the plugin in the image), and
// each project's -- its skills, commands and agents, carried as instructions on its workspace's first fetch, and its
// plugins with what became of each. Read from `/api/customizations`, again whenever the app stream says one changed.
import { Badge, Button, MessageBar, MessageBarBody, SearchBox, Spinner, Tab, TabList, Table, TableBody, TableCell, TableHeader, TableHeaderCell, TableRow, Text, Tooltip, makeStyles, shorthands, tokens } from "@fluentui/react-components";
import type { Customizations, ProjectInventory, ProjectItem, ProjectPluginState } from "@orbit-web/contracts";
import { useMemo, useState } from "react";
import { useCustomizations } from "../../hooks/useLive";
import { useViewport } from "../../hooks/useViewport";

const useStyles = makeStyles({
  root: { display: "flex", flexDirection: "column", gap: "14px", minWidth: 0, maxWidth: "100%" },
  bar: { display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap", minWidth: 0 },
  searchMobile: { width: "100%", flexGrow: 1 },
  muted: { color: tokens.colorNeutralForeground3, overflowWrap: "anywhere" },
  project: { display: "flex", flexDirection: "column", gap: "6px", minWidth: 0, maxWidth: "100%" },
  projectTitle: { overflowWrap: "anywhere", wordBreak: "break-word" },
  name: { fontFamily: tokens.fontFamilyMonospace, fontSize: tokens.fontSizeBase200, overflowWrap: "anywhere" },
  description: { color: tokens.colorNeutralForeground2, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" },
  cardList: { display: "flex", flexDirection: "column", gap: "8px", listStyleType: "none", margin: 0, padding: 0, minWidth: 0, maxWidth: "100%" },
  card: {
    display: "flex",
    flexDirection: "column",
    gap: "4px",
    minWidth: 0,
    maxWidth: "100%",
    paddingTop: "10px",
    paddingRight: "12px",
    paddingBottom: "10px",
    paddingLeft: "12px",
    borderRadius: tokens.borderRadiusLarge,
    ...shorthands.border("1px", "solid", tokens.colorNeutralStroke2),
    backgroundColor: tokens.colorNeutralBackground1,
  },
  cardTop: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", minWidth: 0 },
});

type Kind = "skill" | "command" | "agent";

interface Line {
  name: string;
  kind: Kind;
  description: string | null;
}

const lines = (items: ProjectItem[], kind: Kind): Line[] => items.map((i) => ({ name: i.name, kind, description: i.description }));

const matching = (all: Line[], q: string): Line[] => (q === "" ? all : all.filter((l) => `${l.name} ${l.description ?? ""}`.toLowerCase().includes(q)));

function Lines({ rows, label, mobile }: { rows: Line[]; label: string; mobile: boolean }) {
  const s = useStyles();
  if (rows.length === 0) return <Text size={200} className={s.muted}>Nothing here.</Text>;
  if (mobile) {
    return (
      <ul className={s.cardList} aria-label={label}>
        {rows.map((l) => (
          <li key={`${l.kind}:${l.name}`} className={s.card}>
            <div className={s.cardTop}>
              <span className={s.name}>{l.kind === "command" ? `/${l.name}` : l.name}</span>
              <Badge size="small" appearance="tint" color="subtle">
                {l.kind}
              </Badge>
            </div>
            <Text size={200} className={s.description}>
              {l.description ?? "—"}
            </Text>
          </li>
        ))}
      </ul>
    );
  }
  return (
    <Table size="small" aria-label={label}>
      <TableHeader>
        <TableRow>
          <TableHeaderCell style={{ width: "34%" }}>Name</TableHeaderCell>
          <TableHeaderCell style={{ width: "12%" }}>Kind</TableHeaderCell>
          <TableHeaderCell>Description</TableHeaderCell>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((l) => (
          <TableRow key={`${l.kind}:${l.name}`}>
            <TableCell>
              <span className={s.name}>{l.kind === "command" ? `/${l.name}` : l.name}</span>
            </TableCell>
            <TableCell>{l.kind}</TableCell>
            <TableCell>
              <span className={s.description}>{l.description ?? "—"}</span>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

const projectLines = (inv: ProjectInventory): Line[] => [...lines(inv.skills, "skill"), ...lines(inv.commands, "command"), ...lines(inv.agents, "agent")];

// A chat started without a repository brings nothing of a project's: only chats with one are listed.
function useCustomizationsView(): { data: Customizations | null; error: string | null; loading: boolean } {
  const read = useCustomizations();
  const data = useMemo(() => (read.data ? { ...read.data, projects: read.data.projects.filter((p) => p.inventory.repository !== null) } : null), [read.data]);
  return { data, error: read.error, loading: read.loading && read.data === null };
}

export function SkillsSection() {
  const s = useStyles();
  const { isMobile } = useViewport();
  const { data, error, loading } = useCustomizationsView();
  const [tab, setTab] = useState<"orbit" | "projects">("projects");
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const orbit = useMemo(() => (data ? [...lines(data.orbit.skills, "skill"), ...lines(data.orbit.agents, "agent")] : []), [data]);
  if (loading) return <Spinner label="Reading what Claude Code is given…" />;
  return (
    <div className={s.root}>
      {error && (
        <MessageBar intent="error">
          <MessageBarBody>{error}</MessageBarBody>
        </MessageBar>
      )}
      <div className={s.bar}>
        <TabList size="small" selectedValue={tab} onTabSelect={(_, d) => setTab(d.value as "orbit" | "projects")}>
          <Tab value="projects">Projects</Tab>
          <Tab value="orbit">Orbit</Tab>
        </TabList>
        <SearchBox className={isMobile ? s.searchMobile : undefined} size={isMobile ? "medium" : "small"} placeholder="Search" aria-label="Search skills" value={query} onChange={(_, d) => setQuery(d.value)} />
      </div>
      {tab === "orbit" && (
        <>
          <Text size={200} className={s.muted}>
            Orbit {data?.orbit.version ?? ""} — the plugin in this image, loaded in every chat.
          </Text>
          <Lines rows={matching(orbit, q)} label="Orbit's skills" mobile={isMobile} />
        </>
      )}
      {tab === "projects" &&
        (data && data.projects.length > 0 ? (
          data.projects.map((p) => (
            <section key={p.sessionId} className={s.project} aria-label={`Skills of ${p.title}`}>
              <Text weight="semibold" className={s.projectTitle}>
                {p.inventory.repository ?? "No repository"} <span className={s.muted}>· {p.title}</span>
              </Text>
              <Text size={200} className={s.muted}>
                {p.inventory.loaded ? "Loaded for this chat, as instructions (no hooks, no pre-run commands)." : "Not loaded for this chat."}
                {p.inventory.claudeMd ? " CLAUDE.md: read by Claude Code from the repository." : ""}
                {p.inventory.truncated ? " (only the first ones are listed)" : ""}
              </Text>
              <Lines rows={matching(projectLines(p.inventory), q)} label={`Skills of ${p.title}`} mobile={isMobile} />
            </section>
          ))
        ) : (
          <Text className={s.muted}>No chat has read a project yet. A chat's repository is read when its workspace is first prepared.</Text>
        ))}
    </div>
  );
}

const STATE: Record<ProjectPluginState, { label: string; color: "success" | "informative" | "warning" | "danger" | "subtle" }> = {
  loaded: { label: "Loaded", color: "success" },
  installed: { label: "Installed", color: "success" },
  installing: { label: "Installing…", color: "informative" },
  declared: { label: "Not run", color: "subtle" },
  failed: { label: "Failed", color: "danger" },
};

export function PluginsSection({ onOpenCode }: { onOpenCode: () => void }) {
  const s = useStyles();
  const { isMobile } = useViewport();
  const { data, error, loading } = useCustomizationsView();
  if (loading) return <Spinner label="Reading the plugins…" />;
  const rows = (data?.projects ?? []).flatMap((p) => p.inventory.plugins.map((plugin) => ({ project: p, plugin })));
  return (
    <div className={s.root}>
      {error && (
        <MessageBar intent="error">
          <MessageBarBody>{error}</MessageBarBody>
        </MessageBar>
      )}
      <Text size={200} className={s.muted}>
        A plugin runs code — hooks, MCP servers — in this container. A repository's own plugins and the ones it declares run only once you turn on “Run project plugins”.{" "}
        <Button appearance="transparent" size="small" onClick={onOpenCode}>
          Settings → Code
        </Button>
      </Text>
      {isMobile ? (
        <ul className={s.cardList} aria-label="Plugins">
          <li className={s.card}>
            <div className={s.cardTop}>
              <span className={s.name}>orbit</span>
              <Badge appearance="tint" color="success">
                Loaded
              </Badge>
            </div>
            <Text size={200} className={s.muted}>
              This image · Orbit {data?.orbit.version ?? ""}
            </Text>
          </li>
          {rows.map(({ project, plugin }) => (
            <li key={`${project.sessionId}:${plugin.kind}:${plugin.id}`} className={s.card}>
              <div className={s.cardTop}>
                <span className={s.name}>{plugin.id}</span>
                <Tooltip content={plugin.detail ?? STATE[plugin.state].label} relationship="description">
                  <Badge appearance="tint" color={STATE[plugin.state].color}>
                    {STATE[plugin.state].label}
                  </Badge>
                </Tooltip>
              </div>
              <Text size={200} className={s.muted}>
                {project.inventory.repository ?? project.title} · {plugin.source}
              </Text>
            </li>
          ))}
        </ul>
      ) : (
        <Table aria-label="Plugins">
          <TableHeader>
            <TableRow>
              <TableHeaderCell>Plugin</TableHeaderCell>
              <TableHeaderCell>Source</TableHeaderCell>
              <TableHeaderCell>Status</TableHeaderCell>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell>
                <span className={s.name}>orbit</span>
              </TableCell>
              <TableCell>This image · Orbit {data?.orbit.version ?? ""}</TableCell>
              <TableCell>
                <Badge appearance="tint" color="success">
                  Loaded
                </Badge>
              </TableCell>
            </TableRow>
            {rows.map(({ project, plugin }) => (
              <TableRow key={`${project.sessionId}:${plugin.kind}:${plugin.id}`}>
                <TableCell>
                  <span className={s.name}>{plugin.id}</span>
                </TableCell>
                <TableCell>
                  {project.inventory.repository ?? project.title} · {plugin.source}
                </TableCell>
                <TableCell>
                  <Tooltip content={plugin.detail ?? STATE[plugin.state].label} relationship="description">
                    <Badge appearance="tint" color={STATE[plugin.state].color}>
                      {STATE[plugin.state].label}
                    </Badge>
                  </Tooltip>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {rows.length === 0 && <Text className={s.muted}>No project has a plugin yet.</Text>}
    </div>
  );
}
