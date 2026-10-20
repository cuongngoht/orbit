import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useBlocker } from "react-router";
import { ConfirmDialog } from "../components/ConfirmDialog";

// One guard for the whole app, mounted in the shell. A page that holds unsaved
// work says so with `useUnsavedChanges(dirty)`; from then on EVERY way out --
// a sidebar link, a breadcrumb, Back, Cancel, closing the tab -- asks first.
//
// It lives above the pages on purpose: the dialog has to outlive the page it
// is leaving, or Fluent leaves the next page aria-hidden (see ConfirmDialog).

const SetDirty = createContext<(dirty: boolean) => void>(() => {});

export function useUnsavedChanges(dirty: boolean) {
  const setDirty = useContext(SetDirty);
  useEffect(() => {
    setDirty(dirty);
    return () => setDirty(false);
  }, [dirty, setDirty]);
}

export function UnsavedChangesGuard({ children }: { children: ReactNode }) {
  const [dirty, setDirty] = useState(false);
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && currentLocation.pathname !== nextLocation.pathname);
  useWarnBeforeUnload(dirty);
  return (
    <SetDirty.Provider value={setDirty}>
      {children}
      <ConfirmDialog
        open={blocker.state === "blocked"}
        title="Leave without saving?"
        confirmLabel="Discard changes"
        cancelLabel="Keep editing"
        destructive
        onConfirm={() => blocker.proceed?.()}
        onCancel={() => blocker.reset?.()}
      >
        What you typed has not been saved and will be lost.
      </ConfirmDialog>
    </SetDirty.Provider>
  );
}

function useWarnBeforeUnload(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
}
