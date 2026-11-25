// RESEARCH SOURCES FOR A MISSION: one research workspace, and the sources of it the work may use -- each pinned to the
// revision it is at now. The employee reads exactly those revisions, read-only, under /input, and a claim it hands in is
// supported only by a quote one of them holds (the server checks the quote). A source with no indexed revision cannot be
// pinned: it says why. Nothing here reads a source's text.
import { Checkbox, Field, Select, Spinner, Text } from "@fluentui/react-components";
import type { ResearchSourceSummary, ResearchWorkspaceSummary } from "@orbit-web/contracts";
import { useResource } from "../../hooks/useResource";
import { t as tr, useI18n } from "../../i18n";
import { research } from "../research/api";
import { useOfficeStyles } from "./parts";

export interface PinnedSources {
  workspaceId: string | null;
  revisionIds: string[];
}

export const NO_SOURCES: PinnedSources = { workspaceId: null, revisionIds: [] };

// Why a source has no revision to pin.
const notPinnable = (src: ResearchSourceSummary): string => (src.state === "failed" ? tr("office.sources.couldNotBeRead", { reason: src.stateReason ? `: ${src.stateReason}` : "" }) : tr("office.sources.notReadYet"));

export function SourcesPicker({ value, onChange }: { value: PinnedSources; onChange: (v: PinnedSources) => void }) {
  const { t } = useI18n();
  const o = useOfficeStyles();
  const workspaces = useResource<ResearchWorkspaceSummary[]>(() => research.workspaces(), []);
  const workspaceId = value.workspaceId;
  const sources = useResource<ResearchSourceSummary[]>(workspaceId === null ? null : () => research.sources(workspaceId), [workspaceId]);
  const toggle = (revisionId: string, on: boolean) => onChange({ workspaceId, revisionIds: on ? [...value.revisionIds, revisionId] : value.revisionIds.filter((r) => r !== revisionId) });

  return (
    <div role="group" aria-label={t("office.sources.groupAria")} className={o.stack}>
      <Text weight="semibold" size={300}>
        {t("office.sources.title")}
      </Text>
      <Text size={200} className={o.muted}>
        {t("office.sources.hint")}
      </Text>
      {workspaces.data === null ? (
        workspaces.error ? (
          <Text size={200}>{t("office.sources.workspacesError", { error: workspaces.error })}</Text>
        ) : (
          <Spinner size="tiny" label={t("office.sources.readingWorkspaces")} />
        )
      ) : workspaces.data.length === 0 ? (
        <Text size={200} className={o.muted}>
          {t("office.sources.noWorkspaces")}
        </Text>
      ) : (
        <Field label={t("office.sources.workspaceLabel")}>
          <Select value={workspaceId ?? ""} onChange={(_, d) => onChange({ workspaceId: d.value === "" ? null : d.value, revisionIds: [] })}>
            <option value="">{t("office.sources.noneOption")}</option>
            {workspaces.data.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name} ({w.sourceCount} {w.sourceCount === 1 ? t("office.sources.sourceOne") : t("office.sources.sourceMany")})
              </option>
            ))}
          </Select>
        </Field>
      )}
      {workspaceId !== null &&
        (sources.data === null ? (
          sources.error ? <Text size={200}>{t("office.sources.sourcesError", { error: sources.error })}</Text> : <Spinner size="tiny" label={t("office.sources.readingSources")} />
        ) : sources.data.length === 0 ? (
          <Text size={200} className={o.muted}>
            {t("office.sources.noSources")}
          </Text>
        ) : (
          <ul className={o.list} aria-label={t("office.sources.sourcesToPinAria")}>
            {sources.data.map((src) => {
              const revision = src.revision;
              return (
                <li key={src.id}>
                  {revision === null ? (
                    <Checkbox disabled label={`${src.title} — ${notPinnable(src)}`} />
                  ) : (
                    <Checkbox label={t("office.sources.revisionOption", { title: src.title, number: revision.number })} checked={value.revisionIds.includes(revision.id)} onChange={(_, d) => toggle(revision.id, d.checked === true)} />
                  )}
                </li>
              );
            })}
          </ul>
        ))}
    </div>
  );
}
