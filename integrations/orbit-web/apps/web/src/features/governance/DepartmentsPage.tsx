// THE COMPANY'S DEPARTMENTS, as its governance sees them: each may have a policy of its own for its employees' work,
// inside what the company's policy delegates to it -- and one with none inherits the company's. Departments are made,
// renamed and archived in the Office (read here from its roster); an archived one is not listed. Opening one shows its
// policy (`#/governance/departments/<departmentId>`, DepartmentPolicyPage).
import { Button, Spinner, Text, makeStyles, shorthands, tokens } from "@fluentui/react-components";
import { ChevronRight16Regular } from "@fluentui/react-icons";
import type { Roster } from "@orbit-web/contracts";
import { RosterIcon } from "../../components/SectionIcons";
import type { GovernancePage } from "../../hooks/useHashRoute";
import { useResource } from "../../hooks/useResource";
import { useI18n } from "../../i18n";
import { useAppEvent } from "../../services/events/AppEvents";
import { office } from "../office/api";
import { DepartmentPolicyPage } from "./DepartmentPolicyPage";
import { Card, EmptyState, ErrorBar, useParts } from "./parts";

const useStyles = makeStyles({
  rowList: { display: "flex", flexDirection: "column", gap: "6px", listStyleType: "none", paddingLeft: 0, marginTop: 0, marginBottom: 0 },
  row: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "10px",
    paddingTop: "12px",
    paddingBottom: "12px",
    paddingLeft: "14px",
    paddingRight: "14px",
    borderRadius: "12px",
    backgroundColor: tokens.colorNeutralBackground2,
    ...shorthands.border("1px", "solid", tokens.colorNeutralStroke2),
    transitionProperty: "background-color, border-color",
    transitionDuration: "140ms",
    ":hover": {
      backgroundColor: tokens.colorNeutralBackground1Hover,
      ...shorthands.borderColor(tokens.colorNeutralStroke1Hover),
    },
    minWidth: 0,
  },
  titleBtn: {
    justifyContent: "flex-start",
    minWidth: "unset",
    maxWidth: "100%",
    paddingLeft: 0,
    paddingRight: 0,
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground1,
    textAlign: "left",
  },
});

function DepartmentList({ go }: { go: (page: GovernancePage, item?: string | null) => void }) {
  const { t } = useI18n();
  const s = useParts();
  const styles = useStyles();
  // The departments come whole with any page of the roster: one read, unfiltered.
  const roster = useResource<Roster>(() => office.roster({ department: null, q: "", status: null }), []);
  useAppEvent("office.changed", (e) => e.data.areas.includes("roster") && void roster.reload());
  const title = t("governance.departments.title");
  const live = roster.data?.departments.filter((d) => !d.archived) ?? [];
  return (
    <Card title={title} icon={<RosterIcon size={18} />} tone="teal" description={t("governance.departments.about")}>
      {roster.data === null ? (
        roster.error ? (
          <ErrorBar text={roster.error} />
        ) : (
          <Spinner label={t("governance.departments.reading")} />
        )
      ) : live.length === 0 ? (
        <EmptyState icon={<RosterIcon size={22} />} tone="teal" title={t(roster.data.office === null ? "governance.departments.noOffice" : "governance.departments.empty")} body={t("governance.departments.emptyBody")} />
      ) : (
        <ul className={styles.rowList} aria-label={title}>
          {live.map((d) => (
            <li key={d.id} className={styles.row}>
              <div className={s.cardTitleStack}>
                <Button className={styles.titleBtn} appearance="transparent" onClick={() => go("departments", d.id)}>
                  {d.name}
                </Button>
                <Text size={200} className={s.muted}>
                  {t(d.members === 1 ? "governance.departments.memberOne" : "governance.departments.memberMany", { count: d.members })}
                  {d.manager !== null ? t("governance.departments.managedBy", { name: d.manager.name }) : ""}
                </Text>
              </div>
              <ChevronRight16Regular aria-hidden className={s.muted} />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export function DepartmentsPage({ item, go }: { item: string | null; go: (page: GovernancePage, item?: string | null) => void }) {
  const s = useParts();
  if (item) return <DepartmentPolicyPage key={item} departmentId={item} go={go} />;
  return (
    <div className={s.page}>
      <DepartmentList go={go} />
    </div>
  );
}
