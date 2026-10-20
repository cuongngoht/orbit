import { useState } from "react";
import { Button, MessageBar, MessageBarActions, MessageBarBody, SearchBox, Tab, TabList, Text, makeStyles, tokens } from "@fluentui/react-components";
import { ArrowClockwise20Regular } from "@fluentui/react-icons";
import { useSearchParams } from "react-router";
import { mutationToken } from "../../shared/api/client";
import { ErrorState } from "../../shared/components/ErrorState";
import { LoadingState } from "../../shared/components/LoadingState";
import { PageHeader } from "../../shared/components/PageHeader";
import type { DeletedSkill, SkillSummary } from "./api/skills.types";
import { DeleteSkillDialog } from "./components/DeleteSkillDialog";
import { SkillList } from "./components/SkillList";
import { useSkills } from "./hooks/useSkills";
import { SKILL_FILTERS, filterOf, visibleSkills, type SkillFilter } from "./skillFilters";
import { orderSkills } from "./skillOrder";

const useStyles = makeStyles({
  toolbar: { display: "flex", alignItems: "center", gap: tokens.spacingHorizontalL, flexWrap: "wrap", marginBottom: tokens.spacingVerticalM },
  search: { width: "20rem", maxWidth: "100%" },
  count: { color: tokens.colorNeutralForeground3, marginLeft: "auto" },
  refetching: { opacity: 0.6, transitionProperty: "opacity", transitionDuration: tokens.durationNormal },
  stack: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalM },
  empty: { display: "flex", flexDirection: "column", alignItems: "flex-start", gap: tokens.spacingVerticalS, paddingBlock: tokens.spacingVerticalXXL },
});

// The filter and the search live in the URL (`?show=attention&q=sql`), so a
// view can be linked to, survives a refresh, and Back undoes a filter.
function useListParams() {
  const [params, setParams] = useSearchParams();
  const set = (key: string, value: string, fallback: string) =>
    setParams(
      (p) => {
        if (value === fallback) p.delete(key);
        else p.set(key, value);
        return p;
      },
      { replace: key === "q" },
    );
  return {
    filter: filterOf(params.get("show")),
    query: params.get("q") ?? "",
    setFilter: (v: SkillFilter) => set("show", v, "all"),
    setQuery: (v: string) => set("q", v, ""),
    // One update: two in a row would each start from this render's params, and the second would undo the first.
    clear: () => setParams({}),
  };
}

export function SkillsPage() {
  const styles = useStyles();
  const skills = useSkills();
  const list = useListParams();
  const readOnly = !mutationToken();
  const [deleting, setDeleting] = useState<SkillSummary | null>(null);
  const [deleted, setDeleted] = useState<DeletedSkill | null>(null);
  const onDeleted = (answer: DeletedSkill) => {
    setDeleting(null);
    setDeleted(answer);
  };
  const all = skills.data ?? [];
  const shown = orderSkills(visibleSkills(all, list.filter, list.query));
  return (
    <>
      <PageHeader
        title="Skills"
        description="Every directory under skills/ with a SKILL.md. Open one to edit it, or delete it — a backup is always taken first."
        actions={
          <Button icon={<ArrowClockwise20Regular />} onClick={() => skills.refetch()} disabled={skills.isFetching}>
            {skills.isFetching ? "Refreshing…" : "Refresh"}
          </Button>
        }
      />
      <div className={styles.stack}>
        {deleted && <DeletedNotice deleted={deleted} onDismiss={() => setDeleted(null)} />}
        {skills.isPending && <LoadingState label="Loading skills…" />}
        {skills.isError && <ErrorState error={skills.error} title="Could not list skills" onRetry={() => skills.refetch()} />}
      </div>
      {skills.data && (
        <>
          <div className={styles.toolbar}>
            <SearchBox className={styles.search} placeholder="Search name or description" aria-label="Search skills" value={list.query} onChange={(_, d) => list.setQuery(d.value)} />
            <TabList size="small" selectedValue={list.filter} onTabSelect={(_, d) => list.setFilter(d.value as SkillFilter)} aria-label="Show">
              {SKILL_FILTERS.map((f) => (
                <Tab key={f.value} value={f.value}>
                  {f.label} ({visibleSkills(all, f.value, "").length})
                </Tab>
              ))}
            </TabList>
            <Text className={styles.count} aria-live="polite">
              {shown.length === all.length ? `${all.length} skills` : `Showing ${shown.length} of ${all.length}`}
            </Text>
          </div>
          <div className={skills.isFetching ? styles.refetching : undefined}>
            {shown.length ? <SkillList skills={shown} readOnly={readOnly} onDelete={setDeleting} /> : <NothingMatches onClear={list.clear} total={all.length} />}
          </div>
        </>
      )}
      <DeleteSkillDialog skill={deleting} onDismiss={() => setDeleting(null)} onDeleted={onDeleted} />
    </>
  );
}

function NothingMatches({ onClear, total }: { onClear: () => void; total: number }) {
  const styles = useStyles();
  if (!total) return <Text>No skills found: nothing under skills/ has a SKILL.md.</Text>;
  return (
    <div className={styles.empty}>
      <Text weight="semibold">No skills match.</Text>
      <Text>Try another word, or show every skill.</Text>
      <Button onClick={onClear}>Clear search and filter</Button>
    </div>
  );
}

function DeletedNotice({ deleted, onDismiss }: { deleted: DeletedSkill; onDismiss: () => void }) {
  return (
    <MessageBar intent="success">
      <MessageBarBody>
        Deleted {deleted.id}. Backup: {deleted.backup}
      </MessageBarBody>
      <MessageBarActions>
        <Button onClick={onDismiss}>Dismiss</Button>
      </MessageBarActions>
    </MessageBar>
  );
}
