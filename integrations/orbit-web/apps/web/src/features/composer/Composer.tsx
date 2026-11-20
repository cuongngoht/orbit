// THE COMPOSER: always at the bottom of the page, on a new session and in a chat. A rounded box for the message (Enter
// sends, Shift+Enter is a new line, an IME composition is never cut short), Send or -- while Claude works -- Stop, and
// under it a toolbar: what the chat starts from on the left (repository, branch), how it runs on the right (model ·
// effort, mode). Typing is always possible; sending waits until the chat can take a message. `/` at the start of the
// message opens the slash menu (SlashMenu.tsx): ↑ ↓ move, Enter or Tab takes one, Escape closes it.
import { Button, Tooltip, makeStyles, mergeClasses, shorthands, tokens } from "@fluentui/react-components";
import { ArrowUp20Filled, SlashForward16Regular, Stop16Filled } from "@fluentui/react-icons";
import type { SlashCommand } from "@orbit-web/contracts";
import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useViewport } from "../../hooks/useViewport";
import { SlashMenu, matching, optionId, slashQuery, useSlashCommands } from "./SlashMenu";

const useStyles = makeStyles({
  wrap: { width: "100%", maxWidth: "820px", marginTop: 0, marginRight: "auto", marginBottom: 0, marginLeft: "auto", display: "flex", flexDirection: "column", gap: "8px" },
  anchor: { position: "relative" },
  card: {
    display: "flex",
    flexDirection: "column",
    borderRadius: "22px",
    backgroundColor: "var(--orbit-card-bg)",
    ...shorthands.border("1px", "solid", tokens.colorNeutralStroke1),
    boxShadow: "var(--orbit-composer-shadow)",
    transitionProperty: "border-color, box-shadow",
    transitionDuration: "160ms",
    transitionTimingFunction: "cubic-bezier(0.2, 0, 0, 1)",
    ":focus-within": { ...shorthands.borderColor(tokens.colorNeutralStroke1Pressed), boxShadow: "var(--orbit-composer-shadow-focus)" },
  },
  cardMobile: {
    borderRadius: "24px",
  },
  input: {
    width: "100%",
    minWidth: 0,
    resize: "none",
    ...shorthands.border("0"),
    outlineStyle: "none",
    backgroundColor: "transparent",
    color: tokens.colorNeutralForeground1,
    fontFamily: tokens.fontFamilyBase,
    fontSize: "15px",
    lineHeight: "1.5",
    paddingTop: "14px",
    paddingRight: "16px",
    paddingBottom: "6px",
    paddingLeft: "16px",
    maxHeight: "40vh",
    "::placeholder": { color: tokens.colorNeutralForeground4 },
  },
  inputMobile: {
    fontSize: "16px",
    paddingTop: "12px",
    paddingRight: "16px",
    paddingBottom: "4px",
    paddingLeft: "16px",
    maxHeight: "32dvh",
  },
  footer: {
    display: "flex",
    alignItems: "flex-end",
    gap: "6px",
    paddingTop: "4px",
    paddingRight: "10px",
    paddingBottom: "10px",
    paddingLeft: "10px",
    minWidth: 0,
  },
  footerMobile: {
    paddingTop: "2px",
    paddingRight: "8px",
    paddingBottom: "8px",
    paddingLeft: "8px",
  },
  slashBtn: {
    flexShrink: 0,
    minWidth: "36px",
    minHeight: "36px",
    borderRadius: "9999px",
    "@media (pointer: coarse)": { minWidth: "40px", minHeight: "40px" },
  },
  toolbarArea: {
    flexGrow: 1,
    minWidth: 0,
    display: "flex",
    alignItems: "center",
  },
  send: {
    flexShrink: 0,
    minWidth: "36px",
    minHeight: "36px",
    width: "36px",
    height: "36px",
  },
  sendTouch: {
    minWidth: "40px",
    minHeight: "40px",
    width: "40px",
    height: "40px",
  },
  toolbar: { display: "flex", alignItems: "center", gap: "4px", flexWrap: "wrap", width: "100%", minWidth: 0 },
  toolbarMobile: { flexWrap: "nowrap", overflowX: "auto", gap: "6px", paddingRight: "18px" },
  side: { display: "flex", alignItems: "center", gap: "4px", flexWrap: "wrap", minWidth: 0 },
  sideMobile: { flexWrap: "nowrap", flexShrink: 0, gap: "6px" },
  grow: { flexGrow: 1 },
});

export interface ComposerProps {
  placeholder: string;
  // Whether a message can be sent now (the chat's status lets it).
  canSend: boolean;
  // Claude is working: Stop instead of Send.
  running: boolean;
  busy?: boolean;
  autoFocus?: boolean;
  onSend: (text: string) => void;
  onStop?: () => void;
  // The toolbar under the box: what the chat starts from, and how it runs.
  left?: ReactNode;
  right?: ReactNode;
  // Said just above the box (an error, a notice).
  above?: ReactNode;
  // Where the slash menu reads what this chat can run (none: no menu), and a number that moves when that changed.
  commandsPath?: string;
  commandsVersion?: number;
}

const rowsOf = (text: string, mobile: boolean): number => Math.min(mobile ? 8 : 10, Math.max(mobile ? 1 : 2, text.split("\n").length));

export function Composer(p: ComposerProps) {
  const s = useStyles();
  const { isMobile, isCoarse } = useViewport();
  const [text, setText] = useState("");
  const [active, setActive] = useState(0);
  // The text the menu was closed at with Escape: it stays closed until the text changes.
  const [dismissed, setDismissed] = useState<string | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const listId = useId();
  const query = p.commandsPath === undefined ? null : slashQuery(text);
  const open = query !== null && dismissed !== text;
  const slash = useSlashCommands(p.commandsPath, p.commandsVersion ?? 0, open);
  const items = open && slash.data !== null ? matching(slash.data.commands, query ?? "") : [];
  const current = Math.min(active, Math.max(items.length - 1, 0));
  const offering = open && items.length > 0;
  const ready = p.canSend && !p.running && !p.busy && text.trim().length > 0;
  const edit = (value: string) => {
    setText(value);
    setActive(0);
  };
  const submit = () => {
    if (!ready) return;
    p.onSend(text);
    edit("");
  };
  const pick = (c: SlashCommand) => {
    edit(`/${c.name} `);
    input.current?.focus();
  };
  const toggleSlash = () => {
    if (open) {
      setDismissed(text);
      return;
    }
    setDismissed(null);
    if (!text.startsWith("/")) edit("/");
    input.current?.focus();
  };
  // The menu's keys, while it offers something; true when the key was its.
  const menuKey = (e: KeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (open && e.key === "Escape") {
      setDismissed(text);
      return true;
    }
    if (!offering) return false;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      setActive((current + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length);
      return true;
    }
    const takes = e.key === "Tab" || (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing);
    if (takes && items[current] !== undefined) pick(items[current]);
    return takes;
  };
  const touchSized = isMobile || isCoarse;
  return (
    <div className={s.wrap}>
      {p.above}
      <div className={s.anchor}>
        {open && <SlashMenu id={listId} items={items} active={current} query={query ?? ""} state={slash} onPick={pick} onHover={setActive} onClose={() => setDismissed(text)} />}
        <form
          className={mergeClasses(s.card, isMobile && s.cardMobile)}
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <textarea
            ref={input}
            className={mergeClasses(s.input, isMobile && s.inputMobile)}
            rows={rowsOf(text, isMobile)}
            placeholder={p.placeholder}
            aria-label="Message"
            aria-autocomplete={p.commandsPath === undefined ? undefined : "list"}
            aria-controls={offering ? listId : undefined}
            aria-activedescendant={offering ? optionId(listId, current) : undefined}
            value={text}
            autoFocus={p.autoFocus}
            onChange={(e) => edit(e.target.value)}
            onKeyDown={(e) => {
              if (menuKey(e)) {
                e.preventDefault();
                return;
              }
              if (!isCoarse && e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit();
              }
            }}
          />
          <div className={mergeClasses(s.footer, isMobile && s.footerMobile)}>
            {isMobile && p.commandsPath !== undefined && (
              <Button
                type="button"
                className={s.slashBtn}
                appearance={open ? "primary" : "subtle"}
                icon={<SlashForward16Regular />}
                aria-label="Skills and commands"
                onClick={toggleSlash}
              />
            )}
            <div className={s.toolbarArea}>
              {(p.left || p.right) && (
                <div className={mergeClasses(s.toolbar, isMobile && s.toolbarMobile, isMobile && "orbit-hscroll orbit-hscroll-fade")} role="toolbar" aria-label="How this chat runs">
                  <div className={mergeClasses(s.side, isMobile && s.sideMobile)}>{p.left}</div>
                  {!isMobile && <div className={s.grow} />}
                  <div className={mergeClasses(s.side, isMobile && s.sideMobile)}>{p.right}</div>
                </div>
              )}
            </div>
            {p.running ? (
              <Tooltip content="Stop" relationship="label">
                <Button className={mergeClasses(s.send, touchSized && s.sendTouch)} shape="circular" appearance="secondary" icon={<Stop16Filled />} onClick={p.onStop} />
              </Tooltip>
            ) : (
              <Tooltip content="Send" relationship="label">
                <Button className={mergeClasses(s.send, touchSized && s.sendTouch)} shape="circular" appearance="primary" type="submit" icon={<ArrowUp20Filled />} disabled={!ready} />
              </Tooltip>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
