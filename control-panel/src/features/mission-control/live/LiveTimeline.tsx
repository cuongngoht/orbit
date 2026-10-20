import { Button, Caption1, makeStyles, mergeClasses, tokens } from "@fluentui/react-components";
import { memo, useLayoutEffect, useRef } from "react";
import { formatClock } from "../../../shared/format";
import { FILTERS, GLYPHS } from "./liveWords";
import type { LiveFilter, LiveRow } from "./live.types";

const useStyles = makeStyles({
  frame: { position: "relative" },
  scroll: { maxHeight: "34rem", overflowY: "auto", border: `1px solid ${tokens.colorNeutralStroke2}`, borderRadius: tokens.borderRadiusMedium, padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalM}` },
  list: { margin: 0, padding: 0, listStyleType: "none", display: "flex", flexDirection: "column", gap: "2px" },
  row: { display: "grid", gridTemplateColumns: "1.5rem 5.5rem 1fr", columnGap: tokens.spacingHorizontalS, alignItems: "baseline", padding: "2px 4px", borderRadius: tokens.borderRadiusSmall },
  stage: { marginTop: tokens.spacingVerticalS, fontWeight: tokens.fontWeightSemibold, letterSpacing: "0.04em" },
  qa: { paddingInlineStart: tokens.spacingHorizontalL },
  failed: { color: tokens.colorPaletteRedForeground1 },
  glyph: { textAlign: "center" },
  time: { fontFamily: tokens.fontFamilyMonospace, color: tokens.colorNeutralForeground3 },
  detail: { gridColumn: "3", color: tokens.colorNeutralForeground3, overflowWrap: "anywhere" },
  // The newest line, briefly: once, never looping, never under reduced motion.
  fresh: {
    animationName: { from: { backgroundColor: tokens.colorBrandBackground2 }, to: { backgroundColor: "transparent" } },
    animationDuration: "1500ms",
    animationFillMode: "forwards",
    "@media (prefers-reduced-motion: reduce)": { animationName: "none" },
  },
  newer: { position: "absolute", insetInlineEnd: tokens.spacingHorizontalM, bottom: tokens.spacingVerticalM },
  earlier: { marginBottom: tokens.spacingVerticalS },
  empty: { color: tokens.colorNeutralForeground3 },
});

/** How close to the bottom still counts as "at the newest line". */
export const NEAR_BOTTOM_PX = 48;

const LiveEventRow = memo(function LiveEventRow({ row, fresh }: { row: LiveRow; fresh: boolean }) {
  const styles = useStyles();
  const glyph = GLYPHS[row.glyph];
  return (
    <li data-key={row.key} data-new={fresh ? "true" : undefined} data-source={row.source === "task" ? "task" : "qa"} className={mergeClasses(styles.row, row.stage && styles.stage, row.source !== "task" && styles.qa, row.failed && styles.failed, fresh && styles.fresh)}>
      <span role="img" aria-label={glyph.label} className={styles.glyph}>
        {glyph.char}
      </span>
      <span className={styles.time}>{formatClock(row.at)}</span>
      <span>
        {row.line}
        {row.failed && <span className="visually-hidden"> (failed)</span>}
      </span>
      {row.detail && <Caption1 className={styles.detail}>{row.detail}</Caption1>}
    </li>
  );
});

export interface TimelineProps {
  rows: readonly LiveRow[];
  hidden: number;
  filter: LiveFilter;
  following: boolean;
  newSinceFollow: number;
  onFollow: () => void;
  onUnfollow: () => void;
  onLoadEarlier: () => void;
}

// The feed: every line appended where it belongs, never redrawn from scratch. It follows the newest line
// while the person is at the bottom, and stops the moment they scroll up to read -- a button then says
// how many lines arrived and takes them back.
export function LiveTimeline({ rows, hidden, filter, following, newSinceFollow, onFollow, onUnfollow, onLoadEarlier }: TimelineProps) {
  const styles = useStyles();
  const scroller = useRef<HTMLDivElement>(null);
  const keeps = FILTERS.find((f) => f.id === filter)?.keeps ?? (() => true);
  const shown = rows.filter(keeps);
  const newest = rows.at(-1)?.key;
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && following) el.scrollTop = el.scrollHeight;
  }, [rows.length, following, filter]);
  const scrolled = () => {
    const el = scroller.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight <= NEAR_BOTTOM_PX;
    if (near && !following) onFollow();
    if (!near && following) onUnfollow();
  };
  const toNewest = () => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
    onFollow();
  };
  return (
    <div className={styles.frame}>
      <div ref={scroller} className={styles.scroll} onScroll={scrolled} data-testid="live-scroll">
        {hidden > 0 && (
          <Button size="small" appearance="subtle" className={styles.earlier} onClick={onLoadEarlier}>
            {`Load earlier (${hidden} not shown)`}
          </Button>
        )}
        {shown.length === 0 ? (
          <Caption1 className={styles.empty}>{rows.length === 0 ? "Nothing has been written yet." : "No line matches this filter."}</Caption1>
        ) : (
          <ol className={styles.list} aria-label="Timeline">
            {shown.map((row) => (
              <LiveEventRow key={row.key} row={row} fresh={row.key === newest} />
            ))}
          </ol>
        )}
      </div>
      {!following && newSinceFollow > 0 && (
        <Button className={styles.newer} appearance="primary" size="small" onClick={toNewest}>
          {`↓ ${newSinceFollow} new event${newSinceFollow === 1 ? "" : "s"}`}
        </Button>
      )}
    </div>
  );
}
