import { useCallback, type MouseEvent } from "react";
import { useNavigate } from "react-router";

// Every in-app link is a real <a href>, so middle-click, Ctrl/⌘-click and "copy
// link" behave like any website. A plain left click is taken over and routed
// client-side -- which is also what lets the unsaved-changes guard see it.
export function useFollow() {
  const navigate = useNavigate();
  return useCallback(
    (to: string) => (event: MouseEvent) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      navigate(to);
    },
    [navigate],
  );
}
