// SETTINGS → SKILLS and PLUGINS: what Claude Code is given to work with. Orbit's own (the plugin in the image), and
// each project's -- its skills, commands and agents, carried as instructions on its workspace's first fetch, and its
// plugins with what became of each. Read from `/api/customizations`, again whenever the app stream says one changed.
import { Badge, Button, MessageBar, MessageBarBody, SearchBox, Spinner, Tab, TabList, Table, TableBody, TableCell, TableHeader, TableHeaderCell, TableRow, Text, Tooltip, makeStyles, shorthands, tokens } from "@fluentui/react-components";
import type { Customizations, ProjectInventory, ProjectItem, ProjectPluginState } from "@orbit-web/contracts";
import { useMemo, useState } from "react";
import { useCustomizations } from "../../hooks/useLive";
import { useViewport } from "../../hooks/useViewport";
import { useI18n, type MessageKey } from "../../i18n";

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
  const { t } = useI18n();
  const s = useStyles();
  if (rows.length === 0) return <Text size={200} className={s.muted}>{t("settings.customize.nothingHere")}</Text>;
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
            <Text size={200} className={s.description} title={l.description ?? undefined}>
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
          <TableHeaderCell style={{ width: "34%" }}>{t("settings.customize.colName")}</TableHeaderCell>
          <TableHeaderCell style={{ width: "12%" }}>{t("settings.customize.colKind")}</TableHeaderCell>
          <TableHeaderCell>{t("settings.customize.colDescription")}</TableHeaderCell>
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
              <span className={s.description} title={l.description ?? undefined}>
                {l.description ?? "—"}
              </span>
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
  const { t } = useI18n();
  const s = useStyles();
  const { isMobile } = useViewport();
  const { data, error, loading } = useCustomizationsView();
  const [tab, setTab] = useState<"orbit" | "projects">("projects");
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const orbit = useMemo(() => (data ? [...lines(data.orbit.skills, "skill"), ...lines(data.orbit.agents, "agent")] : []), [data]);
  if (loading) return <Spinner label={t("settings.customize.skills.loading")} />;
  return (
    <div className={s.root}>
      {error && (
        <MessageBar intent="error">
          <MessageBarBody>{error}</MessageBarBody>
        </MessageBar>
      )}
      <div className={s.bar}>
        <TabList size="small" selectedValue={tab} onTabSelect={(_, d) => setTab(d.value as "orbit" | "projects")}>
          <Tab value="projects">{t("settings.customize.skills.tabProjects")}</Tab>
          <Tab value="orbit">{t("settings.customize.skills.tabOrbit")}</Tab>
        </TabList>
        <SearchBox className={isMobile ? s.searchMobile : undefined} size={isMobile ? "medium" : "small"} placeholder={t("settings.customize.skills.searchPlaceholder")} aria-label={t("settings.customize.skills.searchAria")} value={query} onChange={(_, d) => setQuery(d.value)} />
      </div>
      {tab === "orbit" && (
        <>
          <Text size={200} className={s.muted}>
            {t("settings.customize.skills.orbitSummary", { version: data?.orbit.version ?? "" })}
          </Text>
          <Lines rows={matching(orbit, q)} label={t("settings.customize.skills.orbitLabel")} mobile={isMobile} />
        </>
      )}
      {tab === "projects" &&
        (data && data.projects.length > 0 ? (
          data.projects.map((p) => (
            <section key={p.sessionId} className={s.project} aria-label={t("settings.customize.skills.projectAria", { title: p.title })}>
              <Text weight="semibold" className={s.projectTitle}>
                {p.inventory.repository ?? t("settings.customize.skills.noRepo")} <span className={s.muted}>· {p.title}</span>
              </Text>
              <Text size={200} className={s.muted}>
                {p.inventory.loaded ? t("settings.customize.skills.loaded") : t("settings.customize.skills.notLoaded")}
                {p.inventory.claudeMd ? t("settings.customize.skills.claudeMd") : ""}
                {p.inventory.truncated ? t("settings.customize.skills.truncated") : ""}
              </Text>
              <Lines rows={matching(projectLines(p.inventory), q)} label={t("settings.customize.skills.projectAria", { title: p.title })} mobile={isMobile} />
            </section>
          ))
        ) : (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: "8px" }}>
            <Text className={s.muted}>{t("settings.customize.skills.empty")}</Text>
            <Button size="small" onClick={() => setTab("orbit")}>
              {t("settings.customize.skills.browseOrbit")}
            </Button>
          </div>
        ))}
    </div>
  );
}

const STATE_KEYS: Record<ProjectPluginState, { labelKey: MessageKey; color: "success" | "informative" | "warning" | "danger" | "subtle" }> = {
  loaded: { labelKey: "settings.customize.plugins.state.loaded", color: "success" },
  installed: { labelKey: "settings.customize.plugins.state.installed", color: "success" },
  installing: { labelKey: "settings.customize.plugins.state.installing", color: "informative" },
  declared: { labelKey: "settings.customize.plugins.state.declared", color: "subtle" },
  failed: { labelKey: "settings.customize.plugins.state.failed", color: "danger" },
};

export function PluginsSection({ onOpenCode }: { onOpenCode: () => void }) {
  const { t } = useI18n();
  const s = useStyles();
  const { isMobile } = useViewport();
  const { data, error, loading } = useCustomizationsView();
  if (loading) return <Spinner label={t("settings.customize.plugins.loading")} />;
  const rows = (data?.projects ?? []).flatMap((p) => p.inventory.plugins.map((plugin) => ({ project: p, plugin })));
  return (
    <div className={s.root}>
      {error && (
        <MessageBar intent="error">
          <MessageBarBody>{error}</MessageBarBody>
        </MessageBar>
      )}
      <Text size={200} className={s.muted}>
        {t("settings.customize.plugins.intro")}{" "}
        <Button appearance="transparent" size="small" onClick={onOpenCode}>
          {t("settings.customize.plugins.settingsCode")}
        </Button>
      </Text>
      {isMobile ? (
        <ul className={s.cardList} aria-label={t("settings.customize.plugins.listAria")}>
          <li className={s.card}>
            <div className={s.cardTop}>
              <span className={s.name}>orbit</span>
              <Badge appearance="tint" color="success">
                {t("settings.customize.plugins.state.loaded")}
              </Badge>
            </div>
            <Text size={200} className={s.muted}>
              {t("settings.customize.plugins.thisImage", { version: data?.orbit.version ?? "" })}
            </Text>
          </li>
          {rows.map(({ project, plugin }) => (
            <li key={`${project.sessionId}:${plugin.kind}:${plugin.id}`} className={s.card}>
              <div className={s.cardTop}>
                <span className={s.name}>{plugin.id}</span>
                <Tooltip content={plugin.detail ?? t(STATE_KEYS[plugin.state].labelKey)} relationship="description">
                  <Badge appearance="tint" color={STATE_KEYS[plugin.state].color}>
                    {t(STATE_KEYS[plugin.state].labelKey)}
                  </Badge>
                </Tooltip>
              </div>
              <Text size={200} className={s.muted}>
                {project.inventory.repository ?? project.title} · {plugin.source}
              </Text>
              {plugin.detail && (
                <Text size={200} style={{ color: plugin.state === "failed" ? tokens.colorPaletteRedForeground1 : tokens.colorNeutralForeground3 }}>
                  {plugin.detail}
                </Text>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <Table aria-label={t("settings.customize.plugins.listAria")}>
          <TableHeader>
            <TableRow>
              <TableHeaderCell>{t("settings.customize.plugins.colPlugin")}</TableHeaderCell>
              <TableHeaderCell>{t("settings.customize.plugins.colSource")}</TableHeaderCell>
              <TableHeaderCell>{t("settings.customize.plugins.colStatus")}</TableHeaderCell>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell>
                <span className={s.name}>orbit</span>
              </TableCell>
              <TableCell>{t("settings.customize.plugins.thisImage", { version: data?.orbit.version ?? "" })}</TableCell>
              <TableCell>
                <Badge appearance="tint" color="success">
                  {t("settings.customize.plugins.state.loaded")}
                </Badge>
              </TableCell>
            </TableRow>
            {rows.map(({ project, plugin }) => (
              <TableRow key={`${project.sessionId}:${plugin.kind}:${plugin.id}`}>
                <TableCell>
                  <span className={s.name}>{plugin.id}</span>
                </TableCell>
                <TableCell>
                  <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                    <span>{project.inventory.repository ?? project.title} · {plugin.source}</span>
                    {plugin.detail && (
                      <Text size={200} style={{ color: plugin.state === "failed" ? tokens.colorPaletteRedForeground1 : tokens.colorNeutralForeground3 }}>
                        {plugin.detail}
                      </Text>
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  <Tooltip content={plugin.detail ?? t(STATE_KEYS[plugin.state].labelKey)} relationship="description">
                    <Badge appearance="tint" color={STATE_KEYS[plugin.state].color}>
                      {t(STATE_KEYS[plugin.state].labelKey)}
                    </Badge>
                  </Tooltip>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {rows.length === 0 && <Text className={s.muted}>{t("settings.customize.plugins.empty")}</Text>}
    </div>
  );
}
