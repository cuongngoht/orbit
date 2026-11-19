// A new chat: choose a repository the GitHub account can reach, a branch, a Claude model, and say what to do.
import { Badge, Button, Field, Input, MessageBar, MessageBarBody, Select, Spinner, Text, Title3, makeStyles, mergeClasses, tokens } from "@fluentui/react-components";
import { ArrowClockwise20Regular, LockClosed16Regular, Search20Regular } from "@fluentui/react-icons";
import { MODEL_CHOICES, MODEL_LABELS, type BranchList, type ModelChoice, type Repository, type RepositoryList, type SessionSummary } from "@orbit-web/contracts";
import { useMemo, useState } from "react";
import { useResource } from "../../hooks/useResource";
import { errorText, get, send } from "../../services/api";
import { Composer } from "../chat/Composer";

const useStyles = makeStyles({
  root: { maxWidth: "820px", margin: "0 auto", padding: "24px", display: "flex", flexDirection: "column", gap: "16px" },
  row: { display: "flex", gap: "12px", flexWrap: "wrap", alignItems: "flex-end" },
  list: { maxHeight: "260px", overflowY: "auto", border: `1px solid ${tokens.colorNeutralStroke2}`, borderRadius: tokens.borderRadiusMedium, margin: 0, padding: "4px", listStyle: "none" },
  option: { display: "flex", alignItems: "center", gap: "8px", padding: "6px 8px", borderRadius: tokens.borderRadiusSmall, cursor: "pointer", ":hover": { backgroundColor: tokens.colorNeutralBackground1Hover } },
  chosen: { backgroundColor: tokens.colorBrandBackground2 },
  grow: { flexGrow: 1, minWidth: 0 },
  muted: { color: tokens.colorNeutralForeground3 },
});

export function NewChat({ defaultModel, onCreated }: { defaultModel: ModelChoice; onCreated: (s: SessionSummary) => void }) {
  const s = useStyles();
  const repos = useResource<RepositoryList>(() => get("/api/repositories"), []);
  const [query, setQuery] = useState("");
  const [repo, setRepo] = useState<Repository | null>(null);
  const [pickedBranch, setPickedBranch] = useState<string | null>(null);
  const [pickedModel, setPickedModel] = useState<ModelChoice | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const branches = useResource<BranchList>(repo ? () => get(`/api/repositories/${repo.owner}/${repo.name}/branches`) : null, [repo?.fullName]);

  // What a person picked, else the defaults: the repository's default branch, the preferred model.
  const branchList = branches.data?.repository === repo?.fullName ? (branches.data?.branches ?? []) : [];
  const branch = pickedBranch ?? branchList.find((b) => b.isDefault)?.name ?? branchList[0]?.name ?? "";
  const model = pickedModel ?? defaultModel;

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (repos.data?.repositories ?? []).filter((r) => q === "" || r.fullName.toLowerCase().includes(q)).slice(0, 200);
  }, [repos.data, query]);

  const refresh = async () => {
    try {
      repos.set(await get<RepositoryList>("/api/repositories?refresh=1"));
    } catch (err) {
      setError(errorText(err));
    }
  };

  const start = async (prompt: string) => {
    if (!repo || !branch) return;
    setBusy(true);
    setError(null);
    try {
      onCreated(await send<SessionSummary>("POST", "/api/sessions", { repository: repo.fullName, branch, model, prompt }));
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  };

  return (
    <div className={s.root}>
      <Title3>New chat</Title3>
      <Field label="Repository">
        <div className={s.row}>
          <Input className={s.grow} contentBefore={<Search20Regular />} placeholder="Search repositories" value={query} onChange={(_, d) => setQuery(d.value)} aria-label="Search repositories" />
          <Button icon={<ArrowClockwise20Regular />} onClick={() => void refresh()} aria-label="Refresh the repository list">
            Refresh
          </Button>
        </div>
      </Field>
      {repos.loading && !repos.data && <Spinner size="tiny" label="Reading your repositories with GitHub CLI…" />}
      {repos.error && (
        <MessageBar intent="error">
          <MessageBarBody>{repos.error}</MessageBarBody>
        </MessageBar>
      )}
      {repos.data && (
        <ul className={s.list} role="listbox" aria-label="Repositories">
          {shown.length === 0 && <li className={s.muted}>No repository matches.</li>}
          {shown.map((r) => (
            <li key={r.fullName} role="option" aria-selected={repo?.fullName === r.fullName} className={mergeClasses(s.option, repo?.fullName === r.fullName && s.chosen)} onClick={() => {
                setRepo(r);
                setPickedBranch(null);
              }}>
              <span className={s.grow}>
                <Text weight="semibold">{r.name}</Text> <Text className={s.muted}>{r.owner}</Text>
              </span>
              {r.private && (
                <Badge appearance="outline" icon={<LockClosed16Regular />} size="small">
                  Private
                </Badge>
              )}
              {r.archived && (
                <Badge appearance="outline" size="small">
                  Archived
                </Badge>
              )}
              {r.defaultBranch && <Text size={200} className={s.muted}>{r.defaultBranch}</Text>}
            </li>
          ))}
        </ul>
      )}
      {repos.data?.partial && <Text size={200} className={s.muted}>One of the two listings could not be read; the list may be incomplete. Refresh to try again.</Text>}
      <div className={s.row}>
        <Field label="Branch">
          <Select value={branch} onChange={(_, d) => setPickedBranch(d.value)} disabled={!repo || branches.loading} aria-label="Branch">
            {branchList.map((b) => (
              <option key={b.name} value={b.name}>
                {b.name}
                {b.isDefault ? " (default)" : ""}
                {b.protected ? " · protected" : ""}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Claude model">
          <Select value={model} onChange={(_, d) => setPickedModel(d.value as ModelChoice)} aria-label="Claude model">
            {MODEL_CHOICES.map((m) => (
              <option key={m} value={m}>
                {MODEL_LABELS[m]}
              </option>
            ))}
          </Select>
        </Field>
        {branches.loading && repo && <Spinner size="tiny" />}
      </div>
      {branches.error && (
        <MessageBar intent="error">
          <MessageBarBody>{branches.error}</MessageBarBody>
        </MessageBar>
      )}
      <Text size={200} className={s.muted}>
        {repo ? `${repo.fullName} is cloned into this session's own workspace, on a branch of its own made from ${branch || "the branch you choose"}. Nothing is pushed.` : "Choose a repository to start."}
      </Text>
      {error && (
        <MessageBar intent="error">
          <MessageBarBody>{error}</MessageBarBody>
        </MessageBar>
      )}
      <Composer placeholder="Ask Orbit…" disabled={!repo || !branch || busy} busy={busy} running={false} onSend={(text) => void start(text)} onStop={() => undefined} />
    </div>
  );
}
