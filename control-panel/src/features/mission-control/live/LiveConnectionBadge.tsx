import { Badge, makeStyles } from "@fluentui/react-components";
import { CONNECTION, REPLAY } from "./liveWords";
import type { ConnectionState } from "./live.types";

const useStyles = makeStyles({
  dot: { display: "inline-block", marginInlineEnd: "4px" },
  // The one animation in Mission Control: the connection is alive. Never under reduced motion.
  pulse: {
    animationName: { "0%": { opacity: 1 }, "50%": { opacity: 0.3 }, "100%": { opacity: 1 } },
    animationDuration: "1200ms",
    animationIterationCount: "infinite",
    animationTimingFunction: "ease-in-out",
    "@media (prefers-reduced-motion: reduce)": { animationName: "none" },
  },
});

/** Whether this page holds a healthy live stream -- in words, with a glyph, and a pulse only while LIVE. */
export function LiveConnectionBadge({ connection, replay }: { connection: ConnectionState; replay: boolean }) {
  const styles = useStyles();
  const look = replay ? { ...REPLAY, pulses: false } : CONNECTION[connection];
  return (
    <span role="status" aria-label={look.say} data-connection={replay ? "replay" : connection} data-pulses={look.pulses ? "true" : "false"}>
      <Badge appearance="tint" color={look.tone}>
        <span aria-hidden="true" className={look.pulses ? `${styles.dot} ${styles.pulse}` : styles.dot}>
          {look.glyph}
        </span>
        {look.word}
      </Badge>
    </span>
  );
}
