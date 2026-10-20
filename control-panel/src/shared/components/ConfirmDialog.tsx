import type { ReactNode } from "react";
import { Button, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, makeStyles, tokens } from "@fluentui/react-components";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

const useStyles = makeStyles({
  destructive: {
    backgroundColor: tokens.colorPaletteRedBackground3,
    color: tokens.colorNeutralForegroundOnBrand,
    ":hover": { backgroundColor: tokens.colorPaletteRedForeground1, color: tokens.colorNeutralForegroundOnBrand },
  },
});

// A modal "are you sure": nothing happens until the confirm button is pressed.
// Cancel comes first, so it is what the dialog focuses when it opens and what
// Enter presses by accident; Escape and the backdrop cancel too.
//
// Keep it MOUNTED and close it with `open={false}`, and mount it above whatever
// the confirmation replaces: while a Fluent modal is open everything outside it
// is aria-hidden, and a modal whose owner unmounts as it closes leaves the whole
// page hidden from assistive technology.
export function ConfirmDialog(props: ConfirmDialogProps) {
  const styles = useStyles();
  return (
    <Dialog modalType="alert" open={props.open} onOpenChange={(_, data) => !data.open && !props.busy && props.onCancel()}>
      <DialogSurface>
        <DialogBody>
          <DialogTitle>{props.title}</DialogTitle>
          <DialogContent>{props.children}</DialogContent>
          <DialogActions>
            <Button onClick={props.onCancel} disabled={props.busy}>
              {props.cancelLabel ?? "Cancel"}
            </Button>
            <Button appearance="primary" className={props.destructive ? styles.destructive : undefined} onClick={props.onConfirm} disabled={props.busy}>
              {props.busy ? "Working…" : props.confirmLabel}
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
