// What a new chat starts from, in the composer's toolbar: a source (GitHub or Azure DevOps), then one of the
// repositories that source lists, then a branch -- or no repository at all. A source that is not connected says so
// and offers to connect it (Settings → Connectors). Repositories are read only while the picker is open.
import {
  Button,
  Menu,
  MenuItemRadio,
  MenuList,
  MenuPopover,
  MenuTrigger,
  MessageBar,
  MessageBarBody,
  Popover,
  PopoverSurface,
  PopoverTrigger,
  SearchBox,
  Spinner,
  Tab,
  TabList,
  Text,
  makeStyles,
  mergeClasses,
  shorthands,
  tokens,
} from "@fluentui/react-components";
import { ArrowSync16Regular, BranchFork16Regular, Checkmark16Regular, ChevronDown12Regular, LockClosed12Regular } from "@fluentui/react-icons";
import { REPOSITORY_SOURCES, SOURCE_LABELS, type BranchList, type Repository, type RepositoryList, type RepositorySource, type SourcesStatus } from "@orbit-web/contracts";
import { useMemo, useState } from "react";
import { ResponsiveSheet } from "../../components/ResponsiveSheet";
import { SourceMark } from "../../components/SourceMark";
import { isConnected } from "../../hooks/useLive";
import { useResource } from "../../hooks/useResource";
import { useViewport } from "../../hooks/useViewport";
import { useI18n } from "../../i18n";
import { get } from "../../services/api";

const useStyles = makeStyles({
  trigger: {
    minWidth: "unset",
    minHeight: "30px",
    maxWidth: "200px",
    flexShrink: 0,
    borderRadius: "9999px",
    fontWeight: tokens.fontWeightRegular,
    color: tokens.colorNeutralForeground2,
    transitionProperty: "background-color, color",
    transitionDuration: "140ms",
    ":hover": { backgroundColor: tokens.colorSubtleBackgroundHover },
  },
  triggerMobile: {
    maxWidth: "164px",
    minHeight: "34px",
    borderRadius: "9999px",
    paddingTop: "0",
    paddingRight: "10px",
    paddingBottom: "0",
    paddingLeft: "10px",
    backgroundColor: tokens.colorNeutralBackground2,
    ...shorthands.border("1px", "solid", "transparent"),
  },
  label: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  surface: { width: "400px", maxWidth: "90vw", padding: "8px", display: "flex", flexDirection: "column", gap: "8px" },
  sheetInner: { display: "flex", flexDirection: "column", gap: "10px" },
  list: { maxHeight: "300px", overflowY: "auto", display: "flex", flexDirection: "column", margin: 0, padding: 0, listStyleType: "none" },
  option: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    width: "100%",
    paddingTop: "6px",
    paddingRight: "8px",
    paddingBottom: "6px",
    paddingLeft: "8px",
    borderRadius: tokens.borderRadiusMedium,
    border: "none",
    backgroundColor: "transparent",
    color: tokens.colorNeutralForeground1,
    textAlign: "left",
    cursor: "pointer",
    ":hover": { backgroundColor: tokens.colorSubtleBackgroundHover },
    "@media (pointer: coarse)": { minHeight: "46px", paddingTop: "8px", paddingBottom: "8px" },
  },
  optionMobile: { minHeight: "46px", paddingTop: "8px", paddingBottom: "8px" },
  selected: { backgroundColor: tokens.colorSubtleBackgroundSelected },
  text: { display: "flex", flexDirection: "column", minWidth: 0, flexGrow: 1 },
  name: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  muted: { color: tokens.colorNeutralForeground3 },
  row: { display: "flex", alignItems: "center", gap: "8px" },
  refreshBtn: { "@media (pointer: coarse)": { minWidth: "40px", minHeight: "40px" } },
  connect: { display: "flex", flexDirection: "column", gap: "8px", padding: "8px" },
  footer: { borderTop: `1px solid ${tokens.colorNeutralStroke2}`, paddingTop: "6px" },
});

export interface RepositoryChoice {
  source: RepositorySource;
  repository: Repository;
}

const MAX_SHOWN = 200;

function Listing({ source, selected, onPick, mobile }: { source: RepositorySource; selected: RepositoryChoice | null; onPick: (c: RepositoryChoice) => void; mobile: boolean }) {
  const { t } = useI18n();
  const s = useStyles();
  const [query, setQuery] = useState("");
  const [refresh, setRefresh] = useState(0);
  const list = useResource<RepositoryList>(() => get(`/api/repositories?source=${source}${refresh > 0 ? "&refresh=1" : ""}`), [source, refresh]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (list.data?.repositories ?? []).filter((r) => q === "" || r.fullName.toLowerCase().includes(q)).slice(0, MAX_SHOWN);
  }, [list.data, query]);
  return (
    <>
      <div className={s.row}>
        <SearchBox size={mobile ? "medium" : "small"} style={{ flexGrow: 1 }} placeholder={t("chat.repoPicker.searchPlaceholder", { source: SOURCE_LABELS[source] })} aria-label={t("chat.repoPicker.searchAria")} value={query} onChange={(_, d) => setQuery(d.value)} />
        <Button className={s.refreshBtn} size={mobile ? "medium" : "small"} appearance="subtle" icon={<ArrowSync16Regular />} aria-label={t("chat.repoPicker.refreshAria")} onClick={() => setRefresh((n) => n + 1)} />
      </div>
      {list.loading && list.data === null && <Spinner size="tiny" label={t("chat.repoPicker.reading")} />}
      {list.error && (
        <MessageBar intent="error">
          <MessageBarBody>{list.error}</MessageBarBody>
        </MessageBar>
      )}
      {list.data?.partial && <Text size={200} className={s.muted}>{t("chat.repoPicker.partialWarning")}</Text>}
      <ul className={s.list} role="listbox" aria-label={t("chat.repoPicker.listAria")}>
        {shown.map((r) => {
          const isSelected = selected?.repository.id === r.id && selected.source === source;
          return (
            <li key={r.id} role="option" aria-selected={isSelected} aria-label={r.fullName}>
              <button type="button" className={mergeClasses(s.option, mobile && s.optionMobile, isSelected && s.selected)} onClick={() => onPick({ source, repository: r })}>
                <SourceMark source={source} />
                <span className={s.text}>
                  <span className={s.name}>{r.name}</span>
                  <Text size={200} className={s.muted}>
                    {r.project ? `${r.owner} / ${r.project}` : r.owner}
                    {r.defaultBranch ? ` · ${r.defaultBranch}` : ""}
                  </Text>
                </span>
                {r.private && <LockClosed12Regular aria-label={t("chat.repoPicker.privateAria")} />}
                {isSelected && <Checkmark16Regular />}
              </button>
            </li>
          );
        })}
        {list.data !== null && shown.length === 0 && (
          <li>
            <Text size={200} className={s.muted}>
              {t("chat.repoPicker.noMatch")}
            </Text>
          </li>
        )}
      </ul>
    </>
  );
}

function RepoPickerBody({
  source,
  onTab,
  connected,
  value,
  onPick,
  onConnect,
  mobile,
}: {
  source: RepositorySource;
  onTab: (src: RepositorySource) => void;
  connected: boolean;
  value: RepositoryChoice | null;
  onPick: (c: RepositoryChoice | null) => void;
  onConnect: (src: RepositorySource) => void;
  mobile: boolean;
}) {
  const { t } = useI18n();
  const s = useStyles();
  return (
    <>
      <TabList size={mobile ? "medium" : "small"} selectedValue={source} onTabSelect={(_, d) => onTab(d.value as RepositorySource)}>
        {REPOSITORY_SOURCES.map((src) => (
          <Tab key={src} value={src} icon={<SourceMark source={src} />}>
            {SOURCE_LABELS[src]}
          </Tab>
        ))}
      </TabList>
      {connected ? (
        <Listing source={source} selected={value} onPick={onPick} mobile={mobile} />
      ) : (
        <div className={s.connect}>
          <Text>{t("chat.repoPicker.connectPrompt", { source: SOURCE_LABELS[source] })}</Text>
          <div>
            <Button
              appearance="primary"
              size={mobile ? "medium" : "small"}
              onClick={() => onConnect(source)}
            >
              {t("chat.repoPicker.connectBtn", { source: SOURCE_LABELS[source] })}
            </Button>
          </div>
        </div>
      )}
      <div className={s.footer}>
        <button type="button" className={mergeClasses(s.option, mobile && s.optionMobile, value === null && s.selected)} onClick={() => onPick(null)}>
          <SourceMark source={null} />
          <span className={s.text}>
            <span className={s.name}>{t("chat.repoPicker.noRepo")}</span>
            <Text size={200} className={s.muted}>
              {t("chat.repoPicker.noRepoDesc")}
            </Text>
          </span>
          {value === null && <Checkmark16Regular />}
        </button>
      </div>
    </>
  );
}

export function RepositoryPicker({ value, onChange, sources, onConnect }: { value: RepositoryChoice | null; onChange: (c: RepositoryChoice | null) => void; sources: SourcesStatus | null; onConnect: (source: RepositorySource) => void }) {
  const { t } = useI18n();
  const s = useStyles();
  const { isMobile } = useViewport();
  const [open, setOpen] = useState(false);
  const firstConnected = REPOSITORY_SOURCES.find((src) => isConnected(sources, src)) ?? "github";
  const [tab, setTab] = useState<RepositorySource | null>(null);
  const source = tab ?? value?.source ?? firstConnected;
  const connected = isConnected(sources, source);
  const pick = (c: RepositoryChoice | null) => {
    onChange(c);
    setOpen(false);
  };
  const connect = (src: RepositorySource) => {
    setOpen(false);
    onConnect(src);
  };
  const trigger = (
    <Button
      className={mergeClasses(s.trigger, isMobile && s.triggerMobile)}
      appearance="subtle"
      size="small"
      icon={<SourceMark source={value?.source ?? null} />}
      aria-label={value ? t("chat.repoPicker.repoAria", { name: value.repository.fullName }) : t("chat.repoPicker.repoNoneAria")}
      onClick={isMobile ? () => setOpen(true) : undefined}
    >
      <span className={s.label}>{value ? value.repository.name : t("chat.repoPicker.noRepo")}</span>
      <ChevronDown12Regular />
    </Button>
  );

  if (isMobile) {
    return (
      <>
        {trigger}
        <ResponsiveSheet open={open} onOpenChange={setOpen} title={t("chat.repoPicker.chooseRepo")} ariaLabel={t("chat.repoPicker.chooseRepo")}>
          <div className={s.sheetInner}>
            <RepoPickerBody source={source} onTab={setTab} connected={connected} value={value} onPick={pick} onConnect={connect} mobile />
          </div>
        </ResponsiveSheet>
      </>
    );
  }

  return (
    <Popover open={open} onOpenChange={(_, d) => setOpen(d.open)} positioning="above-start" trapFocus>
      <PopoverTrigger disableButtonEnhancement>{trigger}</PopoverTrigger>
      <PopoverSurface className={s.surface} aria-label={t("chat.repoPicker.chooseRepo")}>
        <RepoPickerBody source={source} onTab={setTab} connected={connected} value={value} onPick={pick} onConnect={connect} mobile={false} />
      </PopoverSurface>
    </Popover>
  );
}

// The branch a new chat starts from: the repository's branches, the default first.
export function BranchPicker({ choice, value, onChange }: { choice: RepositoryChoice; value: string | null; onChange: (branch: string) => void }) {
  const { t } = useI18n();
  const s = useStyles();
  const { isMobile } = useViewport();
  const [open, setOpen] = useState(false);
  const branches = useResource<BranchList>(() => get(`/api/repositories/branches?source=${choice.source}&id=${encodeURIComponent(choice.repository.id)}`), [choice.source, choice.repository.id]);
  const current = value ?? choice.repository.defaultBranch ?? branches.data?.branches[0]?.name ?? null;

  if (isMobile) {
    return (
      <>
        <Button
          className={mergeClasses(s.trigger, s.triggerMobile)}
          appearance="subtle"
          size="small"
          icon={<BranchFork16Regular />}
          aria-label={t("chat.repoPicker.branchAria", { branch: current ?? "…" })}
          onClick={() => setOpen(true)}
        >
          <span className={s.label}>{current ?? "…"}</span>
        </Button>
        <ResponsiveSheet open={open} onOpenChange={setOpen} title={t("chat.repoPicker.startingBranch")}>
          {branches.loading && branches.data === null && <Spinner size="tiny" label={t("chat.repoPicker.readingBranches")} />}
          {branches.error && <Text size={200}>{branches.error}</Text>}
          {(branches.data?.branches ?? []).map((b) => {
            const selected = current === b.name;
            return (
              <button
                key={b.name}
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                className={mergeClasses(s.option, s.optionMobile, selected && s.selected)}
                onClick={() => {
                  onChange(b.name);
                  setOpen(false);
                }}
              >
                <span className={s.text}>
                  <span className={s.name}>{b.name}</span>
                  {b.isDefault && (
                    <Text size={200} className={s.muted}>
                      {t("chat.repoPicker.default")}
                    </Text>
                  )}
                </span>
                {selected && <Checkmark16Regular />}
              </button>
            );
          })}
        </ResponsiveSheet>
      </>
    );
  }

  return (
    <Menu checkedValues={{ branch: current ? [current] : [] }} onCheckedValueChange={(_, d) => d.checkedItems[0] && onChange(d.checkedItems[0])}>
      <MenuTrigger disableButtonEnhancement>
        <Button className={s.trigger} appearance="subtle" size="small" icon={<BranchFork16Regular />} aria-label={t("chat.repoPicker.branchAria", { branch: current ?? "…" })}>
          <span className={s.label}>{current ?? "…"}</span>
        </Button>
      </MenuTrigger>
      <MenuPopover>
        <MenuList style={{ maxHeight: "300px", overflowY: "auto" }}>
          {branches.loading && branches.data === null && <Spinner size="tiny" label={t("chat.repoPicker.readingBranches")} />}
          {branches.error && <Text size={200}>{branches.error}</Text>}
          {(branches.data?.branches ?? []).map((b) => (
            <MenuItemRadio key={b.name} name="branch" value={b.name} secondaryContent={b.isDefault ? t("chat.repoPicker.default") : undefined}>
              {b.name}
            </MenuItemRadio>
          ))}
        </MenuList>
      </MenuPopover>
    </Menu>
  );
}
