// CEO CHAT (ADR 0062): the company owner talks to the AI CEO -- the employee holding the CEO's appointment, never a
// virtual one. The page is the company's: without a company it is never shown (App sends `#/ceo` back to `#/`). Without
// a CEO it says so and offers the Office's own ways to hire and appoint one; a CEO who cannot answer says why, while
// Orbit's records still answer the quick actions and what was said stays. A conversation streams the CEO's answer,
// shows Orbit's records as Orbit's (never the CEO's words), and turns a proposal into a mission only when the owner
// gives it.
import { Avatar, Badge, Button, Spinner, Text, ToggleButton, Tooltip, makeStyles, mergeClasses, tokens } from "@fluentui/react-components";
import { Add20Regular, Navigation20Regular, PanelRightContract20Regular, PanelRightExpand20Regular } from "@fluentui/react-icons";
import type { ExecutiveState } from "@orbit-web/contracts";
import { useState } from "react";
import { ResponsiveSheet } from "../../components/ResponsiveSheet";
import type { Resource } from "../../hooks/useResource";
import { useViewport } from "../../hooks/useViewport";
import { useI18n } from "../../i18n";
import { CeoConversation, CeoHome } from "./CeoConversation";
import { CeoDetails, CeoOnboarding } from "./CeoParts";

const useStyles = makeStyles({
  root: { display: "flex", flexDirection: "column", width: "100%", height: "100%", minHeight: 0, minWidth: 0, overflow: "hidden", backgroundColor: tokens.colorNeutralBackground1 },
  top: { display: "flex", alignItems: "center", gap: "10px", minHeight: "56px", paddingLeft: "16px", paddingRight: "12px", borderBottom: `1px solid ${tokens.colorNeutralStroke2}` },
  topMobile: { minHeight: "52px", paddingTop: "max(6px, env(safe-area-inset-top))", paddingLeft: "8px", paddingRight: "8px", gap: "6px" },
  titles: { display: "flex", flexDirection: "column", minWidth: 0, flexGrow: 1 },
  title: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  sub: { color: tokens.colorNeutralForeground3, fontSize: tokens.fontSizeBase200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  body: { display: "flex", flexGrow: 1, minHeight: 0 },
  main: { display: "flex", flexDirection: "column", flexGrow: 1, minWidth: 0, minHeight: 0 },
  side: { width: "320px", flexShrink: 0, borderLeft: `1px solid ${tokens.colorNeutralStroke2}`, overflowY: "auto", padding: "16px" },
  touch: { minWidth: "44px", minHeight: "44px" },
  center: { display: "flex", alignItems: "center", justifyContent: "center", flexGrow: 1 },
});

// What the header says of the CEO's availability.
export function availabilityOf(t: ReturnType<typeof useI18n>["t"], s: ExecutiveState): { text: string; color: "success" | "warning" | "danger" | "informative" } {
  if (s.ceo?.appointment.state === "suspended") return { text: t("executive.state.suspended"), color: "danger" };
  if (s.state === "unavailable") return { text: t("executive.state.unavailable"), color: "danger" };
  const h = s.ceo?.holding ?? null;
  if (h !== null && h.running) return { text: t("executive.state.busy", { mission: h.title }), color: "warning" };
  if (h !== null) return { text: t("executive.state.waitingTeam", { mission: h.title }), color: "informative" };
  return { text: t("executive.state.available"), color: "success" };
}

export interface CeoChatViewProps {
  state: Resource<ExecutiveState>;
  conversationId: string | null;
  go: (conversationId: string | null) => void;
  onOpenNav?: () => void;
}

export function CeoChatView({ state, conversationId, go, onOpenNav }: CeoChatViewProps) {
  const { t } = useI18n();
  const s = useStyles();
  const { isMobile, isCompact } = useViewport();
  const [details, setDetails] = useState(false);
  const [records, setRecords] = useState<string[]>([]);
  const data = state.data;
  if (data === null)
    return (
      <div className={s.center}>
        <Spinner label={t("executive.page.loading")} />
      </div>
    );
  const ceo = data.ceo;
  const availability = availabilityOf(t, data);
  const panel = <CeoDetails state={data} records={records} />;
  return (
    <div className={s.root}>
      <header className={mergeClasses(s.top, isMobile && s.topMobile)}>
        {onOpenNav && <Button className={s.touch} appearance="subtle" icon={<Navigation20Regular />} aria-label={t("executive.page.openNavAria")} onClick={onOpenNav} />}
        <Avatar name={ceo?.name ?? t("executive.page.title")} color="colorful" size={32} />
        <div className={s.titles}>
          <Text weight="semibold" className={s.title}>
            {ceo !== null ? ceo.name : t("executive.page.title")}
          </Text>
          <span className={s.sub}>{t("executive.ceo.of", { company: data.company?.name ?? "" })}</span>
        </div>
        {ceo !== null && (
          <Badge appearance="tint" color={availability.color}>
            {availability.text}
          </Badge>
        )}
        {ceo !== null && !isMobile && ceo.execution.model !== null && <Badge appearance="outline">{ceo.execution.model}</Badge>}
        {conversationId !== null && (
          <Tooltip content={t("executive.page.newConversation")} relationship="label">
            <Button appearance="subtle" icon={<Add20Regular />} aria-label={t("executive.page.newConversation")} onClick={() => go(null)}>
              {!isCompact && t("executive.page.newConversation")}
            </Button>
          </Tooltip>
        )}
        {ceo !== null && (
          <ToggleButton appearance="subtle" checked={details} icon={details ? <PanelRightContract20Regular /> : <PanelRightExpand20Regular />} aria-label={t("executive.page.detailsAria")} onClick={() => setDetails((v) => !v)}>
            {!isCompact && t("executive.page.details")}
          </ToggleButton>
        )}
      </header>
      <div className={s.body}>
        <div className={s.main}>
          {data.state === "no_ceo" && conversationId === null ? (
            <CeoOnboarding state={data} onReport={(id) => go(id)} />
          ) : conversationId === null ? (
            <CeoHome state={data} go={go} />
          ) : (
            <CeoConversation key={conversationId} conversationId={conversationId} state={data} onRecords={setRecords} />
          )}
        </div>
        {details && !isCompact && <aside className={s.side}>{panel}</aside>}
      </div>
      {isCompact && (
        <ResponsiveSheet open={details} onOpenChange={setDetails} title={t("executive.panel.title")}>
          {panel}
        </ResponsiveSheet>
      )}
    </div>
  );
}
