import { useEffect } from "react";

const APP = "Orbit Control";

// The tab says which page it is, so two open tabs can be told apart.
export function useDocumentTitle(title: string) {
  useEffect(() => {
    document.title = title ? `${title} · ${APP}` : APP;
  }, [title]);
}
