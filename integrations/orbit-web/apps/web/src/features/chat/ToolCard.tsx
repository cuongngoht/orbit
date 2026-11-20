// One tool call, as the stream reported it: its title, its input, its real output, and how it ended. An Agent call
// holds what its subagent did, linked by the CLI's own parent id.
import { Button, Spinner, Text, makeStyles, mergeClasses, tokens } from "@fluentui/react-components";
import { CheckmarkCircle16Regular, ChevronDown16Regular, ChevronRight16Regular, ErrorCircle16Regular, Warning16Regular } from "@fluentui/react-icons";
import { useState, type ReactNode } from "react";
import { CodeBlock } from "../../components/CodeBlock";
import type { ToolItem } from "./chatReducer";

const useStyles = makeStyles({
  card: { border: `1px solid ${tokens.colorNeutralStroke2}`, borderRadius: tokens.borderRadiusMedium, padding: "6px 10px", display: "flex", flexDirection: "column", gap: "6px", minWidth: 0, maxWidth: "100%", overflow: "hidden" },
  head: { display: "flex", alignItems: "center", gap: "8px", minWidth: 0, minHeight: "36px", "@media (pointer: coarse)": { minHeight: "44px" } },
  headClickable: { cursor: "pointer" },
  toggleBtn: { flexShrink: 0, minWidth: "36px", minHeight: "36px", "@media (pointer: coarse)": { minWidth: "44px", minHeight: "44px" } },
  title: { fontFamily: tokens.fontFamilyMonospace, fontSize: tokens.fontSizeBase200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flexGrow: 1, minWidth: 0 },
  ok: { color: tokens.colorPaletteGreenForeground1 },
  bad: { color: tokens.colorPaletteRedForeground1 },
  warn: { color: tokens.colorPaletteDarkOrangeForeground1 },
  label: { color: tokens.colorNeutralForeground3 },
  children: { borderLeft: `2px solid ${tokens.colorBrandStroke2}`, paddingLeft: "10px", display: "flex", flexDirection: "column", gap: "6px" },
});

function StateIcon({ tool }: { tool: ToolItem }) {
  const s = useStyles();
  if (tool.state === "running") return <Spinner size="extra-tiny" aria-label="running" />;
  if (tool.interrupted) return <Warning16Regular className={s.warn} aria-label="interrupted" />;
  if (tool.state === "failed") return <ErrorCircle16Regular className={s.bad} aria-label="failed" />;
  return <CheckmarkCircle16Regular className={s.ok} aria-label="done" />;
}

export function ToolCard({ tool, children }: { tool: ToolItem; children?: ReactNode }) {
  const s = useStyles();
  const [open, setOpen] = useState(false);
  // A call always has an input; none at all is a shared chat's tool, said by its title only: nothing to show.
  const detailed = tool.input !== "";
  return (
    <div className={s.card} data-testid="tool" data-state={tool.state}>
      <div className={mergeClasses(s.head, detailed && s.headClickable)} onClick={detailed ? () => setOpen((o) => !o) : undefined}>
        {detailed && (
          <Button
            className={s.toggleBtn}
            appearance="transparent"
            size="small"
            icon={open ? <ChevronDown16Regular /> : <ChevronRight16Regular />}
            onClick={(e) => {
              e.stopPropagation();
              setOpen((o) => !o);
            }}
            aria-label={open ? "Hide details" : "Show details"}
            aria-expanded={open}
          />
        )}
        <StateIcon tool={tool} />
        <Text className={s.title}>{tool.title}</Text>
      </div>
      {children && <div className={s.children}>{children}</div>}
      {open && detailed && (
        <>
          <Text size={200} className={s.label}>
            Input{tool.agent ? ` — subagent ${tool.agent.subagentType ?? "general"}` : ""}
          </Text>
          <CodeBlock code={tool.input} language="json" />
          {tool.output !== null && (
            <>
              <Text size={200} className={s.label}>
                {tool.state === "failed" ? "Error" : "Output"}
                {tool.truncated ? " (cut short)" : ""}
              </Text>
              <CodeBlock code={tool.output || "(no output)"} />
            </>
          )}
        </>
      )}
    </div>
  );
}
