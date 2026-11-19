// The input: Enter sends, Shift+Enter is a new line; Stop while Claude is working.
import { Button, Textarea, makeStyles } from "@fluentui/react-components";
import { Send20Filled, Stop20Filled } from "@fluentui/react-icons";
import { useState } from "react";

const useStyles = makeStyles({
  root: { display: "flex", gap: "8px", alignItems: "flex-end" },
  input: { flexGrow: 1 },
});

export function Composer(p: { placeholder: string; disabled: boolean; busy: boolean; running: boolean; onSend: (text: string) => void; onStop: () => void }) {
  const s = useStyles();
  const [text, setText] = useState("");
  const submit = () => {
    if (p.disabled || p.running || text.trim().length === 0) return;
    p.onSend(text);
    setText("");
  };
  return (
    <form
      className={s.root}
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <Textarea
        className={s.input}
        resize="vertical"
        rows={3}
        placeholder={p.placeholder}
        aria-label="Message"
        value={text}
        disabled={p.disabled && !p.running}
        onChange={(_, d) => setText(d.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            submit();
          }
        }}
      />
      {p.running ? (
        <Button appearance="secondary" icon={<Stop20Filled />} onClick={p.onStop}>
          Stop
        </Button>
      ) : (
        <Button appearance="primary" type="submit" icon={<Send20Filled />} disabled={p.disabled || p.busy || text.trim().length === 0}>
          Send
        </Button>
      )}
    </form>
  );
}
