// THE SLASH MENU: `/` at the start of a message lists what the chat can run -- the project's skills and commands first,
// then Orbit's -- by the names Claude Code gives them, read from the API when the list first opens (and again when what
// it is read from changes). The text after the slash narrows it: a skill's own name first, then the plugin's, then a
// word of what it does. Choosing one only writes `/<name> ` into the message, ready for what it takes; nothing is sent until
// the person sends, and Claude Code then runs the skill the message names.
import { Button, Text, makeStyles, mergeClasses, shorthands, tokens } from "@fluentui/react-components";
import { Dismiss16Regular } from "@fluentui/react-icons";
import type { SlashCommand, SlashCommands } from "@orbit-web/contracts";
import { useEffect, useState } from "react";
import { useViewport } from "../../hooks/useViewport";
import { errorText, get } from "../../services/api";

const SHOWN = 60;

const useStyles = makeStyles({
  popup: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: "calc(100% + 8px)",
    zIndex: 10,
    display: "flex",
    flexDirection: "column",
    maxHeight: "min(340px, 45dvh)",
    borderRadius: "16px",
    backgroundColor: "var(--orbit-card-bg)",
    ...shorthands.border("1px", "solid", tokens.colorNeutralStroke2),
    boxShadow: "var(--orbit-composer-shadow)",
    overflow: "hidden",
  },
  bar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: "4px",
    paddingRight: "6px",
    paddingBottom: "4px",
    paddingLeft: "12px",
    ...shorthands.borderBottom("1px", "solid", tokens.colorNeutralStroke2),
  },
  list: { overflowY: "auto", paddingTop: "6px", paddingRight: "6px", paddingBottom: "6px", paddingLeft: "6px" },
  group: { display: "flex", flexDirection: "column" },
  label: { paddingTop: "6px", paddingRight: "10px", paddingBottom: "4px", paddingLeft: "10px", fontSize: tokens.fontSizeBase100, fontWeight: tokens.fontWeightSemibold, color: tokens.colorNeutralForeground3, textTransform: "uppercase", letterSpacing: "0.04em" },
  option: { display: "flex", flexDirection: "column", justifyContent: "center", gap: "2px", paddingTop: "7px", paddingRight: "10px", paddingBottom: "7px", paddingLeft: "10px", borderRadius: "10px", cursor: "pointer", transitionProperty: "background-color", transitionDuration: "120ms", "@media (pointer: coarse)": { minHeight: "48px", paddingTop: "8px", paddingBottom: "8px" } },
  optionMobile: { minHeight: "48px", paddingTop: "8px", paddingBottom: "8px" },
  active: { backgroundColor: tokens.colorSubtleBackgroundSelected },
  line: { display: "flex", alignItems: "baseline", gap: "8px", minWidth: 0 },
  name: { fontFamily: tokens.fontFamilyMonospace, fontSize: tokens.fontSizeBase300, fontWeight: tokens.fontWeightSemibold, color: tokens.colorNeutralForeground1, whiteSpace: "nowrap" },
  hint: { fontSize: tokens.fontSizeBase200, color: tokens.colorNeutralForeground3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  description: { fontSize: tokens.fontSizeBase200, color: tokens.colorNeutralForeground2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  status: { padding: "8px 12px", color: tokens.colorNeutralForeground3, ...shorthands.borderTop("1px", "solid", tokens.colorNeutralStroke2) },
  alone: { borderTopStyle: "none" },
});

// The name being typed: the whole message is `/` and a name without a space yet. Anything else opens no list.
export const slashQuery = (text: string): string | null => /^\/(\S*)$/.exec(text)?.[1] ?? null;

const ownName = (name: string): string => name.slice(name.indexOf(":") + 1);

// A word of what it does starts with `q` (never a piece inside a word: "dep" is not "independent").
const saysWord = (description: string | null, q: string): boolean => (description ?? "").toLowerCase().split(/[^\p{L}\p{N}]+/u).some((w) => w.startsWith(q));

// How well a command answers what was typed: its own name, then its full name, then a word of what it does; -1 when
// not at all.
function rank(c: SlashCommand, q: string): number {
  const name = c.name.toLowerCase();
  if (ownName(name).startsWith(q) || name.startsWith(q)) return 0;
  if (name.includes(q)) return 1;
  return q.length >= 2 && saysWord(c.description, q) ? 2 : -1;
}

// What the list shows for `query`, in the order it shows it: the project's, then Orbit's, each best match first.
export function matching(commands: SlashCommand[], query: string): SlashCommand[] {
  const q = query.toLowerCase();
  const ranked = commands.map((c, i) => ({ c, i, r: rank(c, q) })).filter((x) => x.r >= 0);
  const origin = (c: SlashCommand) => (c.origin === "project" ? 0 : 1);
  return ranked
    .sort((a, b) => origin(a.c) - origin(b.c) || a.r - b.r || a.i - b.i)
    .map((x) => x.c)
    .slice(0, SHOWN);
}

export interface SlashState {
  data: SlashCommands | null;
  error: string | null;
  loading: boolean;
}

// Reads the list once it is wanted, and again when `path` or `version` moves (a chat whose workspace became ready).
export function useSlashCommands(path: string | undefined, version: number, wanted: boolean): SlashState {
  const key = path === undefined ? null : `${path}#${version}`;
  const [got, setGot] = useState<{ key: string; data: SlashCommands | null; error: string | null } | null>(null);
  const fetchNow = wanted && key !== null && got?.key !== key;
  useEffect(() => {
    if (!fetchNow || path === undefined || key === null) return undefined;
    let live = true;
    get<SlashCommands>(path).then(
      (data) => live && setGot({ key, data, error: null }),
      (err: unknown) => live && setGot({ key, data: null, error: errorText(err) }),
    );
    return () => {
      live = false;
    };
  }, [fetchNow, path, key]);
  const current = got !== null && got.key === key ? got : null;
  return { data: current?.data ?? null, error: current?.error ?? null, loading: wanted && current === null };
}

export const optionId = (listId: string, index: number): string => `${listId}-option-${index}`;

const GROUPS: { origin: SlashCommand["origin"]; label: string }[] = [
  { origin: "project", label: "This project" },
  { origin: "orbit", label: "Orbit" },
];

export function SlashMenu(p: { id: string; items: SlashCommand[]; active: number; query: string; state: SlashState; onPick: (c: SlashCommand) => void; onHover: (index: number) => void; onClose?: () => void }) {
  const s = useStyles();
  const { isMobile } = useViewport();
  useEffect(() => {
    document.getElementById(optionId(p.id, p.active))?.scrollIntoView?.({ block: "nearest" });
  }, [p.id, p.active]);
  const status = p.state.loading ? "Reading the skills…" : p.state.error !== null ? `The skills could not be listed: ${p.state.error}` : p.items.length === 0 ? `No skill or command matches “/${p.query}”.` : null;
  const note = p.state.data?.note ?? null;
  const said = [status, note].filter((t): t is string => t !== null);
  return (
    <div className={s.popup}>
      {isMobile && p.onClose && (
        <div className={s.bar}>
          <Text size={200} weight="semibold">
            Skills &amp; commands
          </Text>
          <Button appearance="subtle" size="small" icon={<Dismiss16Regular />} aria-label="Close commands" onClick={p.onClose} />
        </div>
      )}
      {p.items.length > 0 && (
        <div className={s.list} role="listbox" id={p.id} aria-label="Skills and commands">
          {GROUPS.map((g) => {
            const members = p.items.flatMap((c, index) => (c.origin === g.origin ? [{ c, index }] : []));
            if (members.length === 0) return null;
            return (
              <div key={g.origin} className={s.group} role="group" aria-labelledby={`${p.id}-${g.origin}`}>
                <div id={`${p.id}-${g.origin}`} className={s.label} role="presentation">
                  {g.label}
                </div>
                {members.map(({ c, index }) => (
                  <div
                    key={c.name}
                    id={optionId(p.id, index)}
                    role="option"
                    aria-selected={index === p.active}
                    className={mergeClasses(s.option, isMobile && s.optionMobile, index === p.active && s.active)}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      p.onPick(c);
                    }}
                    onMouseEnter={() => p.onHover(index)}
                  >
                    <div className={s.line}>
                      <span data-name className={s.name}>{`/${c.name}`}</span>
                      {c.argumentHint && <span className={s.hint}>{c.argumentHint}</span>}
                    </div>
                    {c.description && <span className={s.description}>{c.description}</span>}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}
      {said.map((t) => (
        <Text key={t} size={200} className={mergeClasses(s.status, p.items.length === 0 && t === said[0] && s.alone)}>
          {t}
        </Text>
      ))}
    </div>
  );
}
