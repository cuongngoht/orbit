// THE COMPOSER: always at the bottom of the page, on a new session and in a chat. A rounded box for the message (Enter
// sends, Shift+Enter is a new line, an IME composition is never cut short), Send or -- while Claude works -- Stop, and
// under it a toolbar: what the chat starts from on the left (repository, branch), how it runs on the right (model ·
// effort, mode). Typing is always possible; sending waits until the chat can take a message.
import { Button, Tooltip, makeStyles, shorthands, tokens } from "@fluentui/react-components";
import { ArrowUp20Filled, Stop16Filled } from "@fluentui/react-icons";
import { useState, type ReactNode } from "react";

const useStyles = makeStyles({
  wrap: { width: "100%", maxWidth: "820px", margin: "0 auto", display: "flex", flexDirection: "column", gap: "6px" },
  box: {
    display: "flex",
    alignItems: "flex-end",
    gap: "8px",
    padding: "10px 10px 10px 16px",
    borderRadius: "16px",
    backgroundColor: tokens.colorNeutralBackground1,
    ...shorthands.border("1px", "solid", tokens.colorNeutralStroke1),
    boxShadow: tokens.shadow4,
    ":focus-within": { ...shorthands.borderColor(tokens.colorNeutralStroke1Pressed), boxShadow: tokens.shadow8 },
  },
  input: {
    flexGrow: 1,
    resize: "none",
    border: "none",
    outlineStyle: "none",
    backgroundColor: "transparent",
    color: tokens.colorNeutralForeground1,
    fontFamily: tokens.fontFamilyBase,
    fontSize: tokens.fontSizeBase400,
    lineHeight: tokens.lineHeightBase400,
    padding: "4px 0",
    maxHeight: "40vh",
    "::placeholder": { color: tokens.colorNeutralForeground4 },
  },
  send: { flexShrink: 0 },
  toolbar: { display: "flex", alignItems: "center", gap: "4px", flexWrap: "wrap", padding: "0 6px" },
  side: { display: "flex", alignItems: "center", gap: "2px", flexWrap: "wrap", minWidth: 0 },
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
}

const rowsOf = (text: string): number => Math.min(10, Math.max(2, text.split("\n").length));

export function Composer(p: ComposerProps) {
  const s = useStyles();
  const [text, setText] = useState("");
  const ready = p.canSend && !p.running && !p.busy && text.trim().length > 0;
  const submit = () => {
    if (!ready) return;
    p.onSend(text);
    setText("");
  };
  return (
    <div className={s.wrap}>
      {p.above}
      <form
        className={s.box}
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <textarea
          className={s.input}
          rows={rowsOf(text)}
          placeholder={p.placeholder}
          aria-label="Message"
          value={text}
          autoFocus={p.autoFocus}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
        />
        {p.running ? (
          <Tooltip content="Stop" relationship="label">
            <Button className={s.send} shape="circular" appearance="secondary" icon={<Stop16Filled />} onClick={p.onStop} />
          </Tooltip>
        ) : (
          <Tooltip content="Send" relationship="label">
            <Button className={s.send} shape="circular" appearance="primary" type="submit" icon={<ArrowUp20Filled />} disabled={!ready} />
          </Tooltip>
        )}
      </form>
      {(p.left || p.right) && (
        <div className={s.toolbar} role="toolbar" aria-label="How this chat runs">
          <div className={s.side}>{p.left}</div>
          <div className={s.grow} />
          <div className={s.side}>{p.right}</div>
        </div>
      )}
    </div>
  );
}
