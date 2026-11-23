// One tool call, as the stream reported it: its title, its input, its real output, and how it ended. An Agent call
// holds what its subagent did, linked by the CLI's own parent id.
import { Button, Spinner, Text, makeStyles, mergeClasses, shorthands, tokens } from "@fluentui/react-components";
import { CheckmarkCircle16Regular, ChevronDown16Regular, ChevronRight16Regular, ErrorCircle16Regular, Warning16Regular } from "@fluentui/react-icons";
import { useState, type ReactNode } from "react";
import { CodeBlock } from "../../components/CodeBlock";
import { useI18n } from "../../i18n";
import type { ToolItem } from "./chatReducer";

const useStyles = makeStyles({
  card: {
    backgroundColor: "var(--orbit-tool-bg)",
    ...shorthands.border("1px", "solid", "transparent"),
    borderRadius: "12px",
    paddingTop: "2px",
    paddingRight: "12px",
    paddingBottom: "2px",
    paddingLeft: "6px",
    display: "flex",
    flexDirection: "column",
    gap: "6px",
    minWidth: 0,
    maxWidth: "100%",
    overflow: "hidden",
    transitionProperty: "background-color, border-color",
    transitionDuration: "140ms",
  },
  cardClickable: {
    ":hover": { backgroundColor: "var(--orbit-tool-hover)" },
  },
  cardOpen: {
    paddingBottom: "10px",
    ...shorthands.borderColor(tokens.colorNeutralStroke2),
  },
  head: { display: "flex", alignItems: "center", gap: "6px", minWidth: 0, minHeight: "36px", borderRadius: "10px", "@media (pointer: coarse)": { minHeight: "42px" } },
  headClickable: { cursor: "pointer" },
  toggleBtn: { flexShrink: 0, minWidth: "28px", minHeight: "28px", color: tokens.colorNeutralForeground3, "@media (pointer: coarse)": { minWidth: "36px", minHeight: "36px" } },
  title: { fontFamily: tokens.fontFamilyMonospace, fontSize: "12.5px", color: tokens.colorNeutralForeground2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flexGrow: 1, minWidth: 0 },
  spinnerWrap: { flexShrink: 0, display: "inline-flex", alignItems: "center" },
  ok: { flexShrink: 0, color: tokens.colorPaletteGreenForeground1 },
  bad: { flexShrink: 0, color: tokens.colorPaletteRedForeground1 },
  warn: { flexShrink: 0, color: tokens.colorPaletteDarkOrangeForeground1 },
  label: { color: tokens.colorNeutralForeground3, paddingLeft: "4px" },
  children: { borderLeft: `2px solid ${tokens.colorNeutralStroke1}`, marginLeft: "10px", paddingLeft: "10px", marginBottom: "6px", display: "flex", flexDirection: "column", gap: "6px" },
});

function StateIcon({ tool }: { tool: ToolItem }) {
  const { t } = useI18n();
  const s = useStyles();
  if (tool.state === "running") return <span className={s.spinnerWrap}><Spinner size="extra-tiny" aria-label={t("chat.tool.stateRunning")} /></span>;
  if (tool.interrupted) return <Warning16Regular className={s.warn} aria-label={t("chat.tool.stateInterrupted")} />;
  if (tool.state === "failed") return <ErrorCircle16Regular className={s.bad} aria-label={t("chat.tool.stateFailed")} />;
  return <CheckmarkCircle16Regular className={s.ok} aria-label={t("chat.tool.stateDone")} />;
}

export function ToolCard({ tool, children }: { tool: ToolItem; children?: ReactNode }) {
  const { t } = useI18n();
  const s = useStyles();
  const [open, setOpen] = useState(false);
  // A call always has an input; none at all is a shared chat's tool, said by its title only: nothing to show.
  const detailed = tool.input !== "";
  return (
    <div className={mergeClasses(s.card, detailed && s.cardClickable, open && detailed && s.cardOpen)} data-testid="tool" data-state={tool.state}>
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
            aria-label={open ? t("chat.tool.hideDetails") : t("chat.tool.showDetails")}
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
            {t("chat.tool.inputLabel", {
              subagent: tool.agent ? t("chat.tool.subagentSuffix", { type: tool.agent.subagentType ?? t("chat.tool.subagentGeneral") }) : "",
            })}
          </Text>
          <CodeBlock code={tool.input} language="json" />
          {tool.output !== null && (
            <>
              <Text size={200} className={s.label}>
                {tool.state === "failed" ? t("chat.tool.errorLabel") : t("chat.tool.outputLabel")}
                {tool.truncated ? t("chat.tool.cutShort") : ""}
              </Text>
              <CodeBlock code={tool.output || t("chat.tool.noOutput")} />
            </>
          )}
        </>
      )}
    </div>
  );
}
