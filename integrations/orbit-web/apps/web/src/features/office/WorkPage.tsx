// THE WORK of the office: its missions, open or closed, each with who holds it and where it stands -- a queued one is
// marked as queued, behind its employee's current work. "Load more" reads the next page.
import { Button, Link, MessageBar, MessageBarBody, Spinner, Tab, TabList, Text, mergeClasses } from "@fluentui/react-components";
import { ChevronRight16Regular, Warning16Regular } from "@fluentui/react-icons";
import { WorkMissionIcon } from "../../components/SectionIcons";
import { ASSIGNMENT_STATE_TEXT, type MissionList, type MissionSummary } from "@orbit-web/contracts";
import { useState } from "react";
import type { OfficePage } from "../../hooks/useHashRoute";
import { useI18n } from "../../i18n";
import { errorText } from "../../services/api";
import { office, useOfficeRead } from "./api";
import { AsOf, Callout, EmployeeAvatar, EmptyState, StateBadge, useOfficeStyles, when } from "./parts";

type Go = (page: OfficePage, item?: string | null, tab?: string | null) => void;

function Row({ m, go }: { m: MissionSummary; go: Go }) {
  const { t } = useI18n();
  const o = useOfficeStyles();
  const a = m.assignment;
  return (
    <li className={mergeClasses(o.card, o.cardInteractive)}>
      <div className={o.between}>
        <div className={o.row}>
          <StateBadge text={a.state === "QUEUED" ? t("office.work.rowTitle") : ASSIGNMENT_STATE_TEXT[a.state]} state={a.state} />
          <Link className="orbit-target" as="button" style={{ fontWeight: 600 }} onClick={() => go("mission", m.id)}>
            {m.title}
          </Link>
        </div>
        <div className={o.row}>
          <Text size={200} className={o.muted}>
            {t("office.work.updated", { at: when(m.updatedAt) })}
          </Text>
          <ChevronRight16Regular aria-hidden className={o.muted} />
        </div>
      </div>
      <div className={o.row}>
        <EmployeeAvatar name={a.employeeName} size="sm" />
        <Text size={200} className={o.muted}>
          {a.state === "QUEUED" ? t("office.work.queuedFor", { name: a.employeeName }) : t("office.work.heldBy", { name: a.employeeName })}
          {m.deadline ? t("office.work.due", { at: when(m.deadline) }) : ""}
          {m.nextAction ? t("office.work.next", { next: m.nextAction }) : ""}
        </Text>
      </div>
      {a.reason && (
        <Callout tone="warn" icon={<Warning16Regular />}>
          {a.reason}
        </Callout>
      )}
    </li>
  );
}

function Missions({ first, state, go }: { first: MissionList; state: "open" | "closed"; go: Go }) {
  const { t } = useI18n();
  const o = useOfficeStyles();
  const [more, setMore] = useState<MissionSummary[]>([]);
  const [cursor, setCursor] = useState(first.nextCursor);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const missions = [...first.missions, ...more.filter((m) => !first.missions.some((x) => x.id === m.id))];
  const loadMore = async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await office.missions(state, cursor);
      setMore((x) => [...x, ...next.missions]);
      setCursor(next.nextCursor);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setLoading(false);
    }
  };
  return (
    <>
      {missions.length === 0 ? (
        <EmptyState
          icon={<WorkMissionIcon size={22} />}
          tone="teal"
          title={state === "open" ? t("office.work.emptyOpen") : t("office.work.emptyClosed")}
          action={
            state === "open" ? (
              <Button appearance="primary" onClick={() => go("overview")}>
                {t("office.work.goToOverview")}
              </Button>
            ) : undefined
          }
        />
      ) : (
        <ul className={o.list} aria-label={state === "open" ? t("office.work.openListAria") : t("office.work.closedListAria")}>
          {missions.map((m) => (
            <Row key={m.id} m={m} go={go} />
          ))}
        </ul>
      )}
      {error && (
        <MessageBar intent="error">
          <MessageBarBody>{error}</MessageBarBody>
        </MessageBar>
      )}
      {cursor !== null && (
        <div>
          <Button disabled={loading} onClick={() => void loadMore()}>
            {loading ? t("office.overview.loading") : t("office.overview.loadMore")}
          </Button>
        </div>
      )}
    </>
  );
}

export function WorkPage({ go }: { go: Go }) {
  const { t } = useI18n();
  const o = useOfficeStyles();
  const [state, setState] = useState<"open" | "closed">("open");
  const list = useOfficeRead<MissionList>(() => office.missions(state), [state], ["missions"]);
  return (
    <div className={o.page}>
      <div className={o.between}>
        <div className={o.tabStrip}>
          <TabList selectedValue={state} onTabSelect={(_, d) => setState(d.value as "open" | "closed")} aria-label={t("office.work.whichWorkAria")}>
            <Tab value="open">{t("office.work.tabOpen")}</Tab>
            <Tab value="closed">{t("office.work.tabClosed")}</Tab>
          </TabList>
        </div>
        <AsOf at={list.data?.asOf ?? null} />
      </div>
      {list.data === null ? (
        list.error ? (
          <MessageBar intent="error">
            <MessageBarBody>{list.error}</MessageBarBody>
          </MessageBar>
        ) : (
          <Spinner label={t("office.work.reading")} />
        )
      ) : (
        <Missions key={`${state}:${list.data.asOf}:${list.data.version}`} first={list.data} state={state} go={go} />
      )}
    </div>
  );
}
