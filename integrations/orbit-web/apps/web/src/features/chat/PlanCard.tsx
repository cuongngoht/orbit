// A PLAN, as plan mode proposed it (the ExitPlanMode input): the plan itself, and the one way on -- switch the chat to
// Autonomous and ask Claude to carry the plan out, in the same conversation.
import { Button, Card, CardHeader, Text, makeStyles, tokens } from "@fluentui/react-components";
import { ClipboardTaskList16Regular, Flash16Regular } from "@fluentui/react-icons";
import { Markdown } from "../../components/Markdown";
import { useI18n } from "../../i18n";

const useStyles = makeStyles({
  card: {
    backgroundColor: "var(--orbit-card-bg)",
    borderRadius: "16px",
    boxShadow: "var(--orbit-soft-shadow)",
    borderLeft: `3px solid ${tokens.colorBrandStroke1}`,
  },
  body: { display: "flex", flexDirection: "column", gap: "10px" },
  runBtn: { minHeight: "40px", borderRadius: "9999px", "@media (max-width: 639px)": { width: "100%", minHeight: "44px" } },
  muted: { color: tokens.colorNeutralForeground3 },
});

export function PlanCard({ plan, truncated, onRun, canRun }: { plan: string; truncated: boolean; onRun?: () => void; canRun: boolean }) {
  const { t } = useI18n();
  const s = useStyles();
  return (
    <Card className={s.card} aria-label={t("chat.plan.title")}>
      <CardHeader image={<ClipboardTaskList16Regular />} header={<Text weight="semibold">{t("chat.plan.title")}</Text>} description={<Text size={200} className={s.muted}>{t("chat.plan.description")}</Text>} />
      <div className={s.body}>
        <Markdown text={plan} />
        {truncated && <Text size={200} className={s.muted}>{t("chat.plan.truncated")}</Text>}
        {onRun && (
          <div>
            <Button className={s.runBtn} appearance="primary" icon={<Flash16Regular />} disabled={!canRun} onClick={onRun}>
              {t("chat.plan.runAutonomous")}
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}
