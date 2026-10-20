import { Button, Caption1, Select, Tab, TabList, makeStyles, tokens } from "@fluentui/react-components";
import { useState } from "react";
import type { LogStream, SandboxComponent } from "../../runtime/sandbox.types";
import { useTaskSandbox } from "../mission.api";
import type { TaskRef } from "../mission.types";
import { CONNECTION } from "./liveWords";
import type { OpenStream } from "./stream";
import { useSandboxLogStream } from "./useSandboxLogStream";

const useStyles = makeStyles({
  stack: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalS },
  line: { display: "flex", gap: tokens.spacingHorizontalS, alignItems: "center", flexWrap: "wrap" },
  muted: { color: tokens.colorNeutralForeground3 },
  log: { margin: 0, padding: tokens.spacingHorizontalS, maxHeight: "18rem", overflow: "auto", whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontFamily: tokens.fontFamilyMonospace, backgroundColor: tokens.colorNeutralBackground3, borderRadius: tokens.borderRadiusMedium },
});

const isStream = (value: unknown): value is LogStream => value === "out" || value === "err";

// What the task's application prints, as it prints it -- SECONDARY to the feed above, and closed until a
// person opens it. It is an observation surface: there is no prompt, no input and no command here.
export function LiveSandboxConsole({ taskRef, active, openStream }: { taskRef: TaskRef; active: boolean; openStream?: OpenStream | null }) {
  const styles = useStyles();
  const [open, setOpen] = useState(false);
  const sandbox = useTaskSandbox(taskRef, active && open);
  const components = (sandbox.data?.sandbox?.components ?? []).filter((c): c is SandboxComponent & { session: string } => typeof c.session === "string");
  const [chosen, setChosen] = useState<string | null>(null);
  const session = components.find((c) => c.session === chosen)?.session ?? components[0]?.session ?? null;
  return (
    <section aria-label="Console" className={styles.stack}>
      <div className={styles.line}>
        <Button size="small" appearance="subtle" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? "▾ Console" : "▸ Console"}
        </Button>
        <Caption1 className={styles.muted}>What the task's sandbox application prints. Read-only: nothing typed here runs.</Caption1>
      </div>
      {open && sandbox.data && session === null && <Caption1 className={styles.muted}>This task's sandbox runs nothing that prints.</Caption1>}
      {open && session !== null && (
        <div className={styles.stack}>
          {components.length > 1 && (
            <Select aria-label="Component" value={session} onChange={(_, d) => setChosen(d.value)}>
              {components.map((c) => (
                <option key={c.session} value={c.session}>
                  {c.component}
                </option>
              ))}
            </Select>
          )}
          <Output taskRef={taskRef} session={session} openStream={openStream} />
        </div>
      )}
    </section>
  );
}

function Output({ taskRef, session, openStream }: { taskRef: TaskRef; session: string; openStream?: OpenStream | null }) {
  const styles = useStyles();
  const [stream, setStream] = useState<LogStream>("out");
  return (
    <div className={styles.stack}>
      <TabList size="small" selectedValue={stream} onTabSelect={(_, d) => isStream(d.value) && setStream(d.value)} aria-label="Stream">
        <Tab value="out">stdout</Tab>
        <Tab value="err">stderr</Tab>
      </TabList>
      <Log key={`${session}/${stream}`} taskRef={taskRef} session={session} stream={stream} openStream={openStream} />
    </div>
  );
}

function Log({ taskRef, session, stream, openStream }: { taskRef: TaskRef; session: string; stream: LogStream; openStream?: OpenStream | null }) {
  const styles = useStyles();
  const log = useSandboxLogStream(taskRef, session, stream, { openStream });
  const look = CONNECTION[log.connection];
  return (
    <>
      <Caption1 role="status" className={styles.muted}>{`${look.glyph} ${look.word}${log.truncated ? " · only the newest lines are kept here" : ""}`}</Caption1>
      <pre role="log" aria-label={`Console ${stream === "out" ? "stdout" : "stderr"}`} className={styles.log}>
        {log.lines.length ? log.lines.join("\n") : "Nothing written to this stream yet."}
      </pre>
    </>
  );
}
