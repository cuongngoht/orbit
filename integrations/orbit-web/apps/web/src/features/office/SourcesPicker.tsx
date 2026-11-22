// RESEARCH SOURCES FOR A MISSION: one research workspace, and the sources of it the work may use -- each pinned to the
// revision it is at now. The employee reads exactly those revisions, read-only, under /input, and a claim it hands in is
// supported only by a quote one of them holds (the server checks the quote). A source with no indexed revision cannot be
// pinned: it says why. Nothing here reads a source's text.
import { Checkbox, Field, Select, Spinner, Text } from "@fluentui/react-components";
import type { ResearchSourceSummary, ResearchWorkspaceSummary } from "@orbit-web/contracts";
import { useResource } from "../../hooks/useResource";
import { research } from "../research/api";
import { useOfficeStyles } from "./parts";

export interface PinnedSources {
  workspaceId: string | null;
  revisionIds: string[];
}

export const NO_SOURCES: PinnedSources = { workspaceId: null, revisionIds: [] };

// Why a source has no revision to pin.
const notPinnable = (src: ResearchSourceSummary): string => (src.state === "failed" ? `could not be read${src.stateReason ? `: ${src.stateReason}` : ""}` : "not read yet");

export function SourcesPicker({ value, onChange }: { value: PinnedSources; onChange: (v: PinnedSources) => void }) {
  const o = useOfficeStyles();
  const workspaces = useResource<ResearchWorkspaceSummary[]>(() => research.workspaces(), []);
  const workspaceId = value.workspaceId;
  const sources = useResource<ResearchSourceSummary[]>(workspaceId === null ? null : () => research.sources(workspaceId), [workspaceId]);
  const toggle = (revisionId: string, on: boolean) => onChange({ workspaceId, revisionIds: on ? [...value.revisionIds, revisionId] : value.revisionIds.filter((r) => r !== revisionId) });

  return (
    <div role="group" aria-label="Research sources" className={o.stack}>
      <Text weight="semibold" size={300}>
        Research sources
      </Text>
      <Text size={200} className={o.muted}>
        Optional. The employee reads the revisions you pin here, read-only; a claim it hands in counts as supported only when a source holds the words it quotes.
      </Text>
      {workspaces.data === null ? (
        workspaces.error ? (
          <Text size={200}>The research workspaces could not be read: {workspaces.error}</Text>
        ) : (
          <Spinner size="tiny" label="Reading your research workspaces…" />
        )
      ) : workspaces.data.length === 0 ? (
        <Text size={200} className={o.muted}>
          No research workspace yet: add sources under Research first.
        </Text>
      ) : (
        <Field label="Research workspace">
          <Select value={workspaceId ?? ""} onChange={(_, d) => onChange({ workspaceId: d.value === "" ? null : d.value, revisionIds: [] })}>
            <option value="">None</option>
            {workspaces.data.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name} ({w.sourceCount} {w.sourceCount === 1 ? "source" : "sources"})
              </option>
            ))}
          </Select>
        </Field>
      )}
      {workspaceId !== null &&
        (sources.data === null ? (
          sources.error ? <Text size={200}>Its sources could not be read: {sources.error}</Text> : <Spinner size="tiny" label="Reading its sources…" />
        ) : sources.data.length === 0 ? (
          <Text size={200} className={o.muted}>
            This workspace has no source yet.
          </Text>
        ) : (
          <ul className={o.list} aria-label="Sources to pin">
            {sources.data.map((src) => {
              const revision = src.revision;
              return (
                <li key={src.id}>
                  {revision === null ? (
                    <Checkbox disabled label={`${src.title} — ${notPinnable(src)}`} />
                  ) : (
                    <Checkbox label={`${src.title} — revision ${revision.number}`} checked={value.revisionIds.includes(revision.id)} onChange={(_, d) => toggle(revision.id, d.checked === true)} />
                  )}
                </li>
              );
            })}
          </ul>
        ))}
    </div>
  );
}
