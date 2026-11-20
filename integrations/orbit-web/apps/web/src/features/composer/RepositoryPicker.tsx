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
import { get } from "../../services/api";

const useStyles = makeStyles({
  trigger: { minWidth: "unset", maxWidth: "280px", flexShrink: 0, fontWeight: tokens.fontWeightRegular, color: tokens.colorNeutralForeground2 },
  triggerMobile: {
    maxWidth: "160px",
    minHeight: "36px",
    borderRadius: "9999px",
    paddingTop: "0",
    paddingRight: "10px",
    paddingBottom: "0",
    paddingLeft: "10px",
    backgroundColor: tokens.colorNeutralBackground2,
    ...shorthands.border("1px", "solid", tokens.colorNeutralStroke2),
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
        <SearchBox size={mobile ? "medium" : "small"} style={{ flexGrow: 1 }} placeholder={`Search ${SOURCE_LABELS[source]} repositories`} aria-label="Search repositories" value={query} onChange={(_, d) => setQuery(d.value)} />
        <Button className={s.refreshBtn} size={mobile ? "medium" : "small"} appearance="subtle" icon={<ArrowSync16Regular />} aria-label="Read the repositories again" onClick={() => setRefresh((n) => n + 1)} />
      </div>
      {list.loading && list.data === null && <Spinner size="tiny" label="Reading the repositories…" />}
      {list.error && (
        <MessageBar intent="error">
          <MessageBarBody>{list.error}</MessageBarBody>
        </MessageBar>
      )}
      {list.data?.partial && <Text size={200} className={s.muted}>Some repositories could not be read; the list may be incomplete.</Text>}
      <ul className={s.list} role="listbox" aria-label="Repositories">
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
                {r.private && <LockClosed12Regular aria-label="Private" />}
                {isSelected && <Checkmark16Regular />}
              </button>
            </li>
          );
        })}
        {list.data !== null && shown.length === 0 && (
          <li>
            <Text size={200} className={s.muted}>
              No repository matches.
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
          <Text>Connect {SOURCE_LABELS[source]} to choose one of its repositories.</Text>
          <div>
            <Button
              appearance="primary"
              size={mobile ? "medium" : "small"}
              onClick={() => onConnect(source)}
            >
              Connect {SOURCE_LABELS[source]}
            </Button>
          </div>
        </div>
      )}
      <div className={s.footer}>
        <button type="button" className={mergeClasses(s.option, mobile && s.optionMobile, value === null && s.selected)} onClick={() => onPick(null)}>
          <SourceMark source={null} />
          <span className={s.text}>
            <span className={s.name}>No repository</span>
            <Text size={200} className={s.muted}>
              An empty workspace of its own
            </Text>
          </span>
          {value === null && <Checkmark16Regular />}
        </button>
      </div>
    </>
  );
}

export function RepositoryPicker({ value, onChange, sources, onConnect }: { value: RepositoryChoice | null; onChange: (c: RepositoryChoice | null) => void; sources: SourcesStatus | null; onConnect: (source: RepositorySource) => void }) {
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
      aria-label={value ? `Repository ${value.repository.fullName}` : "Repository: none"}
      onClick={isMobile ? () => setOpen(true) : undefined}
    >
      <span className={s.label}>{value ? value.repository.name : "No repository"}</span>
      <ChevronDown12Regular />
    </Button>
  );

  if (isMobile) {
    return (
      <>
        {trigger}
        <ResponsiveSheet open={open} onOpenChange={setOpen} title="Choose a repository" ariaLabel="Choose a repository">
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
      <PopoverSurface className={s.surface} aria-label="Choose a repository">
        <RepoPickerBody source={source} onTab={setTab} connected={connected} value={value} onPick={pick} onConnect={connect} mobile={false} />
      </PopoverSurface>
    </Popover>
  );
}

// The branch a new chat starts from: the repository's branches, the default first.
export function BranchPicker({ choice, value, onChange }: { choice: RepositoryChoice; value: string | null; onChange: (branch: string) => void }) {
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
          aria-label={`Branch ${current ?? "…"}`}
          onClick={() => setOpen(true)}
        >
          <span className={s.label}>{current ?? "…"}</span>
        </Button>
        <ResponsiveSheet open={open} onOpenChange={setOpen} title="Starting branch">
          {branches.loading && branches.data === null && <Spinner size="tiny" label="Reading the branches…" />}
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
                      default
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
        <Button className={s.trigger} appearance="subtle" size="small" icon={<BranchFork16Regular />} aria-label={`Branch ${current ?? "…"}`}>
          <span className={s.label}>{current ?? "…"}</span>
        </Button>
      </MenuTrigger>
      <MenuPopover>
        <MenuList style={{ maxHeight: "300px", overflowY: "auto" }}>
          {branches.loading && branches.data === null && <Spinner size="tiny" label="Reading the branches…" />}
          {branches.error && <Text size={200}>{branches.error}</Text>}
          {(branches.data?.branches ?? []).map((b) => (
            <MenuItemRadio key={b.name} name="branch" value={b.name} secondaryContent={b.isDefault ? "default" : undefined}>
              {b.name}
            </MenuItemRadio>
          ))}
        </MenuList>
      </MenuPopover>
    </Menu>
  );
}
