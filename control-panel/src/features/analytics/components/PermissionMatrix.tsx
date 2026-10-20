import { Caption1, Link, Table, TableBody, TableCell, TableHeader, TableHeaderCell, TableRow, Tooltip, makeStyles, tokens } from "@fluentui/react-components";
import { Checkmark16Filled } from "@fluentui/react-icons";
import { Card } from "../../../shared/components/Card";
import { useFollow } from "../../../shared/navigation/useFollow";
import { CAPABILITIES, type Analysis } from "../analytics";

const useStyles = makeStyles({
  // Its own stacking context, so the sticky column's zIndex ranks it above the
  // scrolled cells only -- never above the app's sticky top bar.
  scroll: { overflowX: "auto", isolation: "isolate" },
  // Fluent's Table is `table-layout: fixed`, which splits the width evenly and
  // lets a long skill name spill into the next column. Auto sizes the name
  // column to its longest name; past minWidth, the wrapper scrolls instead.
  table: { minWidth: "36rem", tableLayout: "auto" },
  name: { fontFamily: tokens.fontFamilyMonospace, whiteSpace: "nowrap" },
  // The skill column stays put while the capability columns scroll under it,
  // so a row never loses the name it belongs to. Opaque, or they show through.
  sticky: { position: "sticky", left: 0, zIndex: 1, backgroundColor: tokens.colorNeutralBackground1 },
  center: { textAlign: "center" },
  yes: { color: tokens.colorNeutralForeground1 },
  no: { color: tokens.colorNeutralForeground4 },
  muted: { color: tokens.colorNeutralForeground3, fontVariantNumeric: "tabular-nums" },
  headCount: { display: "block", color: tokens.colorNeutralForeground3, fontWeight: tokens.fontWeightRegular },
});

// Seven meaningful columns would be seven colors; a table says it plainly.
// A mark is a check icon with a hidden "Yes", never a colored cell.
export function PermissionMatrix({ permissions, editPath }: { permissions: Analysis["permissions"]; editPath: (id: string) => string }) {
  const styles = useStyles();
  const follow = useFollow();
  const count = (key: string) => permissions.filter((p) => p.capabilities.some((c) => c === key)).length;
  return (
    <Card title="What each skill may do without asking" subtitle="From each skill's allowed-tools: the tools it can use with no permission prompt. Anything else still asks you first.">
      <div className={styles.scroll}>
        <Table size="small" aria-label="Pre-approved tools per skill" className={styles.table}>
          <TableHeader>
            <TableRow>
              <TableHeaderCell className={styles.sticky}>Skill</TableHeaderCell>
              {CAPABILITIES.map((c) => (
                <TableHeaderCell key={c.key} className={styles.center}>
                  <Tooltip content={c.tools} relationship="description">
                    <span>
                      {c.label}
                      <span className={styles.headCount}>
                        {count(c.key)} of {permissions.length}
                      </span>
                    </span>
                  </Tooltip>
                </TableHeaderCell>
              ))}
              <TableHeaderCell>Granted</TableHeaderCell>
            </TableRow>
          </TableHeader>
          <TableBody>
            {permissions.map((p) => (
              <TableRow key={p.id}>
                <TableCell className={styles.sticky}>
                  <Link className={styles.name} href={editPath(p.id)} onClick={follow(editPath(p.id))}>
                    {p.id}
                  </Link>
                </TableCell>
                {CAPABILITIES.map((c) => (
                  <TableCell key={c.key} className={styles.center}>
                    <Mark yes={p.capabilities.some((k) => k === c.key)} />
                  </TableCell>
                ))}
                <TableCell>
                  <Tooltip content={p.tools.length ? p.tools.join(" · ") : "none"} relationship="description">
                    <Caption1 className={styles.muted} tabIndex={0}>
                      {p.tools.length} {p.tools.length === 1 ? "tool" : "tools"}
                    </Caption1>
                  </Tooltip>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </Card>
  );
}

function Mark({ yes }: { yes: boolean }) {
  const styles = useStyles();
  if (!yes)
    return (
      <span className={styles.no}>
        <span aria-hidden>—</span>
        <span className="visually-hidden">No</span>
      </span>
    );
  return (
    <span className={styles.yes}>
      <Checkmark16Filled aria-hidden />
      <span className="visually-hidden">Yes</span>
    </span>
  );
}
