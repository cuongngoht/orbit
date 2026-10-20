import { useState } from "react";
import { Table, TableBody, TableCell, TableHeader, TableHeaderCell, TableRow, Toolbar, ToolbarRadioButton, Tooltip, makeStyles, tokens } from "@fluentui/react-components";
import { DataBarHorizontal20Regular, Table20Regular, Warning16Filled } from "@fluentui/react-icons";
import { Card } from "../../../shared/components/Card";
import { useFollow } from "../../../shared/navigation/useFollow";
import { scaleFor, type Bar } from "../analytics";

interface BarChartProps {
  title: string;
  subtitle: string;
  bars: Bar[];
  /** The value as a reader says it: "437 characters", "12.4 KB" -- tooltip and table. */
  format: (value: number) => string;
  /** The same, bare, at the bar's tip: the unit is already in the subtitle and on the axis. */
  label: (value: number) => string;
  /** Short, for an axis tick. */
  tick: (value: number) => string;
  /** The heading of the value column in the table view. */
  unit: string;
  /** The heading of the name column in the table view: what each bar is. */
  category?: string;
  /** A line the bars are held against, e.g. a documented limit. */
  reference?: { value: number; label: string };
  hrefOf: (id: string) => string;
}

// One series, so one color and no legend: the title says what is plotted.
// Horizontal, because the categories are skill names and names need room.
// Mark specs (dataviz): <= 24px thick, 4px rounded data-end and square at the
// baseline, hairline solid gridlines, the value at the tip, and every row a
// hover AND focus target larger than its bar.
const ROW = "28px";

const useStyles = makeStyles({
  plot: { display: "flex", flexDirection: "column" },
  row: {
    display: "grid",
    gridTemplateColumns: "minmax(7rem, 13rem) 1fr",
    alignItems: "center",
    height: ROW,
    color: tokens.colorNeutralForeground1,
    textDecorationLine: "none",
    borderRadius: tokens.borderRadiusSmall,
    ":hover": { backgroundColor: tokens.colorSubtleBackgroundHover },
    ":focus-visible": { outline: `${tokens.strokeWidthThick} solid ${tokens.colorStrokeFocus2}` },
  },
  label: {
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground2,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    paddingRight: tokens.spacingHorizontalM,
  },
  // Gridlines at every quarter, drawn by the track itself so consecutive rows
  // join into one continuous hairline.
  track: {
    position: "relative",
    height: "100%",
    backgroundImage: `linear-gradient(to right, ${tokens.colorNeutralStroke3} 1px, transparent 1px)`,
    backgroundSize: "25% 100%",
    backgroundRepeat: "repeat-x",
    borderRight: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke3}`,
  },
  bar: {
    position: "absolute",
    top: "7px",
    left: 0,
    height: "14px",
    borderRadius: "0 4px 4px 0",
    backgroundColor: "var(--viz-series-1)",
    transitionProperty: "filter",
    transitionDuration: tokens.durationFaster,
  },
  lift: { filter: "brightness(1.12)" },
  over: { backgroundColor: "var(--viz-warning)" },
  value: {
    position: "absolute",
    top: 0,
    height: "100%",
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalXXS,
    paddingLeft: tokens.spacingHorizontalXS,
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground2,
    fontVariantNumeric: "tabular-nums",
    whiteSpace: "nowrap",
  },
  // The number sits on the card's own surface, so a gridline or the reference
  // line passes BEHIND it instead of through it.
  valueText: { backgroundColor: tokens.colorNeutralBackground1, paddingInline: "2px", borderRadius: tokens.borderRadiusSmall },
  warn: { color: "var(--viz-warning)", flexShrink: 0 },
  reference: { position: "absolute", top: 0, bottom: 0, width: "1px", backgroundColor: tokens.colorNeutralForeground3 },
  axis: { display: "grid", gridTemplateColumns: "minmax(7rem, 13rem) 1fr", height: "20px" },
  ticks: { position: "relative", borderTop: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke1}` },
  tickLabel: {
    position: "absolute",
    top: "3px",
    transform: "translateX(-50%)",
    fontSize: tokens.fontSizeBase100,
    color: tokens.colorNeutralForeground3,
    fontVariantNumeric: "tabular-nums",
    whiteSpace: "nowrap",
  },
  referenceLabel: {
    position: "absolute",
    bottom: "2px",
    transform: "translateX(-50%)",
    fontSize: tokens.fontSizeBase100,
    color: tokens.colorNeutralForeground3,
    whiteSpace: "nowrap",
  },
  referenceRow: { display: "grid", gridTemplateColumns: "minmax(7rem, 13rem) 1fr", height: "18px" },
  numeric: { textAlign: "right", fontVariantNumeric: "tabular-nums" },
});

export function BarChart(props: BarChartProps) {
  const [asTable, setAsTable] = useState(false);
  return (
    <Card as="figure" title={props.title} subtitle={props.subtitle} action={<ViewPicker title={props.title} asTable={asTable} onChange={setAsTable} />}>
      {asTable ? <BarTable {...props} /> : <Plot {...props} />}
    </Card>
  );
}

// Choosing how to SHOW the same data is a choice between views, not a setting
// switched on: one radio group per chart, named after the chart, so a screen
// reader does not hear two identical "Table" switches on one page.
function ViewPicker({ title, asTable, onChange }: { title: string; asTable: boolean; onChange: (asTable: boolean) => void }) {
  return (
    <Toolbar size="small" aria-label={`${title} view`} checkedValues={{ view: [asTable ? "table" : "chart"] }} onCheckedValueChange={(_, d) => onChange(d.checkedItems.includes("table"))}>
      <Tooltip content="Chart" relationship="label">
        <ToolbarRadioButton name="view" value="chart" appearance="subtle" icon={<DataBarHorizontal20Regular />} />
      </Tooltip>
      <Tooltip content="Table" relationship="label">
        <ToolbarRadioButton name="view" value="table" appearance="subtle" icon={<Table20Regular />} />
      </Tooltip>
    </Toolbar>
  );
}

const pct = (value: number, max: number) => `${(value / max) * 100}%`;

// The first tick starts at the axis and the last one ends at it, so neither
// hangs off the edge of the card.
const edgeAligned = (i: number, count: number) => (i === 0 ? "none" : i === count - 1 ? "translateX(-100%)" : undefined);

function Plot({ bars, format, label, tick, reference, hrefOf }: BarChartProps) {
  const styles = useStyles();
  const scale = scaleFor([...bars.map((b) => b.value), reference?.value ?? 0]);
  return (
    <div className={styles.plot}>
      {reference && (
        <div className={styles.referenceRow} aria-hidden>
          <span />
          <span className={styles.ticks} style={{ borderTop: "none" }}>
            <span className={styles.referenceLabel} style={{ left: pct(reference.value, scale.max) }}>
              {reference.label}
            </span>
          </span>
        </div>
      )}
      <div role="list">
        {bars.map((bar) => (
          <BarRow key={bar.id} bar={bar} max={scale.max} format={format} label={label} reference={reference} href={hrefOf(bar.id)} />
        ))}
      </div>
      <div className={styles.axis} aria-hidden>
        <span />
        <span className={styles.ticks}>
          {scale.ticks.map((t, i) => (
            <span key={t} className={styles.tickLabel} style={{ left: pct(t, scale.max), transform: edgeAligned(i, scale.ticks.length) }}>
              {tick(t)}
            </span>
          ))}
        </span>
      </div>
    </div>
  );
}

interface BarRowProps {
  bar: Bar;
  max: number;
  format: (value: number) => string;
  label: (value: number) => string;
  reference?: { value: number; label: string };
  href: string;
}

function BarRow({ bar, max, format, label, reference, href }: BarRowProps) {
  const styles = useStyles();
  const follow = useFollow();
  const [lifted, setLifted] = useState(false);
  const over = reference !== undefined && bar.value > reference.value;
  const said = `${bar.id}: ${format(bar.value)}${over ? `, over the ${reference.label}` : ""}`;
  return (
    <Tooltip content={said} relationship="label" positioning="above-start" withArrow>
      <a
        role="listitem"
        className={styles.row}
        href={href}
        onClick={follow(href)}
        onPointerEnter={() => setLifted(true)}
        onPointerLeave={() => setLifted(false)}
        onFocus={() => setLifted(true)}
        onBlur={() => setLifted(false)}
      >
        <span className={styles.label} title={bar.id}>
          {bar.id}
        </span>
        <span className={styles.track}>
          <span className={`${styles.bar} ${over ? styles.over : ""} ${lifted ? styles.lift : ""}`} style={{ width: pct(bar.value, max) }} />
          {reference && <span className={styles.reference} style={{ left: pct(reference.value, max) }} />}
          <span className={styles.value} style={{ left: pct(bar.value, max) }}>
            <span className={styles.valueText}>
              {over && <Warning16Filled className={styles.warn} />}
              {label(bar.value)}
              {over && " · over limit"}
            </span>
          </span>
        </span>
      </a>
    </Tooltip>
  );
}

// The chart's accessible twin: every value, no hover needed, no color needed.
function BarTable({ title, bars, format, unit, category = "Skill", reference }: BarChartProps) {
  const styles = useStyles();
  return (
    <Table size="small" aria-label={title}>
      <TableHeader>
        <TableRow>
          <TableHeaderCell>{category}</TableHeaderCell>
          <TableHeaderCell className={styles.numeric}>{unit}</TableHeaderCell>
        </TableRow>
      </TableHeader>
      <TableBody>
        {bars.map((bar) => (
          <TableRow key={bar.id}>
            <TableCell>{bar.id}</TableCell>
            <TableCell className={styles.numeric}>
              {format(bar.value)}
              {reference && bar.value > reference.value ? " (over limit)" : ""}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
