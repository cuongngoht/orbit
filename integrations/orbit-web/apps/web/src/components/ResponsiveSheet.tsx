// Bottom sheet container for mobile pickers and compact overlays, built on Fluent UI OverlayDrawer.
import { Button, OverlayDrawer, Text, makeStyles, shorthands, tokens } from "@fluentui/react-components";
import { Dismiss20Regular } from "@fluentui/react-icons";
import type { ReactNode } from "react";

const useStyles = makeStyles({
  sheet: {
    width: "100%",
    height: "auto",
    maxHeight: "85dvh",
    borderTopLeftRadius: "20px",
    borderTopRightRadius: "20px",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    backgroundColor: tokens.colorNeutralBackground1,
  },
  grabberWrap: {
    display: "flex",
    justifyContent: "center",
    paddingTop: "10px",
    paddingBottom: "4px",
    flexShrink: 0,
  },
  grabber: {
    width: "40px",
    height: "4px",
    borderRadius: "9999px",
    backgroundColor: tokens.colorNeutralStroke1,
  },
  head: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "8px",
    paddingTop: "4px",
    paddingRight: "8px",
    paddingBottom: "8px",
    paddingLeft: "16px",
    ...shorthands.borderBottom("1px", "solid", tokens.colorNeutralStroke2),
    flexShrink: 0,
  },
  close: {
    minWidth: "44px",
    minHeight: "44px",
  },
  body: {
    flexGrow: 1,
    minHeight: 0,
    overflowY: "auto",
    paddingTop: "12px",
    paddingRight: "16px",
    paddingBottom: "max(16px, env(safe-area-inset-bottom))",
    paddingLeft: "16px",
    display: "flex",
    flexDirection: "column",
    gap: "10px",
  },
});

export interface ResponsiveSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  ariaLabel?: string;
  children: ReactNode;
}

export function ResponsiveSheet({ open, onOpenChange, title, ariaLabel, children }: ResponsiveSheetProps) {
  const s = useStyles();
  return (
    <OverlayDrawer
      open={open}
      onOpenChange={(_, d) => onOpenChange(d.open)}
      position="bottom"
      modalType="modal"
      className={s.sheet}
      aria-label={ariaLabel ?? title}
    >
      <div className={s.grabberWrap} aria-hidden>
        <span className={s.grabber} />
      </div>
      <div className={s.head}>
        <Text weight="semibold" size={400}>
          {title}
        </Text>
        <Button
          className={s.close}
          appearance="subtle"
          icon={<Dismiss20Regular />}
          aria-label="Close"
          onClick={() => onOpenChange(false)}
        />
      </div>
      <div className={s.body}>{children}</div>
    </OverlayDrawer>
  );
}
