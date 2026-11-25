// THE COMPOSER: always at the bottom of the page, on a new session and in a chat. A rounded box for the message (Enter
// sends, Shift+Enter is a new line, an IME composition is never cut short), Send or -- while Claude works -- Stop, and
// under it a toolbar: what the chat starts from on the left (repository, branch), how it runs on the right (model ·
// effort, mode). Typing is always possible; sending waits until the chat can take a message. `/` at the start of the
// message opens the slash menu (SlashMenu.tsx): ↑ ↓ move, Enter or Tab takes one, Escape closes it. Where the page lets
// a message carry images (onUploadImage), a screenshot pasted, images dropped or picked go with it (ImageAttachments.tsx).
import { Button, Spinner, Tooltip, makeStyles, mergeClasses, shorthands, tokens } from "@fluentui/react-components";
import { ArrowUp20Filled, ImageAdd20Regular, SlashForward16Regular, Stop16Filled } from "@fluentui/react-icons";
import { IMAGE_MEDIA_TYPES, type SlashCommand } from "@orbit-web/contracts";
import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import type { UploadImage } from "../../services/images";
import { AttachmentStrip, filesOf, useImageAttachments } from "./ImageAttachments";
import { useViewport } from "../../hooks/useViewport";
import { useI18n } from "../../i18n";
import { SlashMenu, matching, optionId, slashQuery, useSlashCommands } from "./SlashMenu";

const useStyles = makeStyles({
  wrap: { width: "100%", minWidth: 0, maxWidth: "min(820px, 100%)", marginTop: 0, marginRight: "auto", marginBottom: 0, marginLeft: "auto", display: "flex", flexDirection: "column", gap: "8px" },
  anchor: { position: "relative", minWidth: 0, maxWidth: "100%" },
  card: {
    display: "flex",
    flexDirection: "column",
    minWidth: 0,
    maxWidth: "100%",
    overflow: "hidden",
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
  cardDragging: { ...shorthands.borderColor(tokens.colorBrandStroke1), boxShadow: "var(--orbit-composer-shadow-focus)" },
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
    "::placeholder": { color: tokens.colorNeutralForeground3 },
  },
  inputTouch: {
    fontSize: "16px",
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
    flexWrap: "wrap",
    alignItems: "center",
    rowGap: "6px",
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
  toolbarAreaMobile: {
    flexBasis: "100%",
    width: "100%",
    order: -1,
  },
  sendMobile: {
    marginLeft: "auto",
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
  toolbarMobile: { rowGap: "6px", columnGap: "6px" },
  side: { display: "flex", alignItems: "center", gap: "4px", flexWrap: "wrap", minWidth: 0 },
  sideMobile: { rowGap: "6px", columnGap: "6px" },
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
  defaultValue?: string;
  onDraftChange?: (text: string) => void;
  sendDisabledReason?: string;
  // The words, and the ids of the images that go with them (none where the page takes no images).
  onSend: (text: string, images: string[]) => void | boolean | Promise<boolean | void>;
  // Where a message may carry images: how one is uploaded. Absent: no images (research).
  onUploadImage?: UploadImage;
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
  const { t } = useI18n();
  const s = useStyles();
  const { isMobile, isCoarse } = useViewport();
  const [text, setText] = useState(p.defaultValue ?? "");
  const [active, setActive] = useState(0);
  // The text the menu was closed at with Escape: it stays closed until the text changes.
  const [dismissed, setDismissed] = useState<string | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const images = useImageAttachments(p.onUploadImage);
  const [dragging, setDragging] = useState(false);
  const listId = useId();
  const query = p.commandsPath === undefined ? null : slashQuery(text);
  const open = query !== null && dismissed !== text;
  const slash = useSlashCommands(p.commandsPath, p.commandsVersion ?? 0, open);
  const items = open && slash.data !== null ? matching(slash.data.commands, query ?? "") : [];
  const current = Math.min(active, Math.max(items.length - 1, 0));
  const offering = open && items.length > 0;
  const ready = p.canSend && !p.running && !p.busy && !images.holding && (text.trim().length > 0 || images.ids.length > 0);
  const disabledReason = !p.canSend
    ? p.sendDisabledReason ?? t("chat.composer.sendDisabledUnavailable")
    : p.busy
      ? t("chat.composer.sendDisabledBusy")
      : images.holding
        ? t("chat.composer.sendDisabledUploading")
        : text.trim().length === 0 && images.ids.length === 0
          ? t("chat.composer.sendDisabledEmpty")
          : null;
  const edit = (value: string) => {
    setText(value);
    setActive(0);
    p.onDraftChange?.(value);
  };
  useLayoutEffect(() => {
    const el = input.current;
    if (el === null) return;
    el.style.height = "auto";
    if (el.scrollHeight > 0) el.style.height = `${el.scrollHeight}px`;
  }, [text, isMobile]);
  const clear = () => {
    edit("");
    images.clear();
  };
  const submit = () => {
    if (!ready) return;
    const result = p.onSend(text, images.ids);
    if (result !== null && typeof result === "object" && typeof (result as PromiseLike<unknown>).then === "function") {
      void (result as PromiseLike<boolean | void>).then(
        (ok) => {
          if (ok !== false) clear();
        },
        () => {},
      );
      return;
    }
    if (result !== false) clear();
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
          className={mergeClasses(s.card, isMobile && s.cardMobile, dragging && s.cardDragging)}
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          onDragOver={(e) => {
            if (!images.enabled || !Array.from(e.dataTransfer.types).includes("Files")) return;
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
          }}
          onDrop={(e) => {
            setDragging(false);
            if (images.add(filesOf(e.dataTransfer))) e.preventDefault();
          }}
        >
          <AttachmentStrip items={images.items} notice={images.notice} onRemove={images.remove} />
          <textarea
            ref={input}
            className={mergeClasses(s.input, touchSized && s.inputTouch, isMobile && s.inputMobile)}
            rows={rowsOf(text, isMobile)}
            placeholder={p.placeholder}
            aria-label={t("chat.composer.messageAria")}
            aria-autocomplete={p.commandsPath === undefined ? undefined : "list"}
            aria-controls={offering ? listId : undefined}
            aria-activedescendant={offering ? optionId(listId, current) : undefined}
            value={text}
            autoFocus={p.autoFocus}
            onChange={(e) => edit(e.target.value)}
            onPaste={(e) => {
              // A screenshot on the clipboard goes with the message; words pasted beside it are pasted as words.
              if (images.add(filesOf(e.clipboardData)) && e.clipboardData.getData("text/plain") === "") e.preventDefault();
            }}
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
            {p.commandsPath !== undefined && (
              <Tooltip content={t("chat.composer.slashBtnTooltip")} relationship="label">
                <Button
                  type="button"
                  className={s.slashBtn}
                  appearance={open ? "primary" : "subtle"}
                  icon={<SlashForward16Regular />}
                  aria-label={t("chat.composer.skillsCommandsAria")}
                  onClick={toggleSlash}
                />
              </Tooltip>
            )}
            {images.enabled && (
              <>
                <Tooltip content={t("chat.composer.addImagesTooltip")} relationship="label">
                  <Button type="button" className={s.slashBtn} appearance="subtle" icon={<ImageAdd20Regular />} onClick={() => picker.current?.click()} />
                </Tooltip>
                <input
                  ref={picker}
                  type="file"
                  accept={IMAGE_MEDIA_TYPES.join(",")}
                  multiple
                  hidden
                  aria-hidden="true"
                  tabIndex={-1}
                  data-testid="image-picker"
                  onChange={(e) => {
                    images.add(Array.from(e.target.files ?? []));
                    e.target.value = "";
                  }}
                />
              </>
            )}
            <div className={mergeClasses(s.toolbarArea, isMobile && s.toolbarAreaMobile)}>
              {(p.left || p.right) && (
                <div className={mergeClasses(s.toolbar, isMobile && s.toolbarMobile)} role="toolbar" aria-label={t("chat.composer.toolbarAria")}>
                  <div className={mergeClasses(s.side, isMobile && s.sideMobile)}>{p.left}</div>
                  {!isMobile && <div className={s.grow} />}
                  <div className={mergeClasses(s.side, isMobile && s.sideMobile)}>{p.right}</div>
                </div>
              )}
            </div>
            {p.running ? (
              <Tooltip content={t("chat.composer.stop")} relationship="label">
                <Button className={mergeClasses(s.send, touchSized && s.sendTouch, isMobile && s.sendMobile)} shape="circular" appearance="secondary" icon={<Stop16Filled />} onClick={p.onStop} />
              </Tooltip>
            ) : ready ? (
              <Tooltip content={t("chat.composer.send")} relationship="label">
                <Button className={mergeClasses(s.send, touchSized && s.sendTouch, isMobile && s.sendMobile)} shape="circular" appearance="primary" type="submit" aria-label={t("chat.composer.send")} icon={<ArrowUp20Filled />} />
              </Tooltip>
            ) : (
              <Tooltip content={disabledReason ?? t("chat.composer.send")} relationship="description">
                <span className={isMobile ? s.sendMobile : undefined} style={{ display: "inline-flex" }}>
                  <Button
                    className={mergeClasses(s.send, touchSized && s.sendTouch)}
                    shape="circular"
                    appearance="primary"
                    type="submit"
                    aria-label={t("chat.composer.send")}
                    icon={p.busy ? <Spinner size="extra-tiny" /> : <ArrowUp20Filled />}
                    disabled
                  />
                </span>
              </Tooltip>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
