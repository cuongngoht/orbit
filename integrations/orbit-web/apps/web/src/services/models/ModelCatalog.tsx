// THE MODELS THIS CLAUDE ACCOUNT MAY USE, for every picker of the page: `GET /api/claude/models` (the account's own
// catalog, as its Claude CLI says it -- read again by the API at each sign-in), then `claude.models` when it changes.
// Until it is read, and when the API could not ask the CLI, the fallback list.
import { FALLBACK_CATALOG, type ModelCatalog } from "@orbit-web/contracts";
import { createContext, useContext, type ReactNode } from "react";
import { useResource } from "../../hooks/useResource";
import { t } from "../../i18n";
import { get } from "../api";
import { useAppEvent, useAppStream } from "../events/AppEvents";

const Context = createContext<ModelCatalog>(FALLBACK_CATALOG);

export function ModelCatalogProvider({ children }: { children: ReactNode }) {
  const { generation } = useAppStream();
  const read = useResource<ModelCatalog>(() => get("/api/claude/models"), [generation]);
  const { set } = read;
  useAppEvent("claude.models", (e) => set(e.data.catalog));
  return <Context.Provider value={read.data ?? FALLBACK_CATALOG}>{children}</Context.Provider>;
}

export const useModelCatalog = (): ModelCatalog => useContext(Context);

// The pickers inside hold to ANOTHER catalog: a chat on a connection it names (OpenAI Codex, say) offers that
// connection's own models.
export function ModelCatalogOverride({ catalog, children }: { catalog: ModelCatalog; children: ReactNode }) {
  return <Context.Provider value={catalog}>{children}</Context.Provider>;
}

// A connection's own catalog, as the pickers read one: read from the account, or its CLI's labelled fallback.
export const catalogOfConnection = (c: { catalog: { source: "account" | "fallback" | "none"; models: ModelCatalog["models"]; recommended: string | null } }): ModelCatalog => ({
  source: c.catalog.source === "account" ? "account" : "fallback",
  models: c.catalog.models,
  recommended: c.catalog.recommended ?? c.catalog.models[0]?.id ?? "",
  detail: c.catalog.source === "account" ? null : t("common.models.fallbackDetail"),
});
