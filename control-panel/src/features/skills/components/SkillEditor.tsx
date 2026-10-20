import { useState, type KeyboardEvent, type ReactNode } from "react";
import {
  Badge,
  Breadcrumb,
  BreadcrumbButton,
  BreadcrumbDivider,
  BreadcrumbItem,
  Button,
  Caption1,
  Field,
  MessageBar,
  MessageBarBody,
  MessageBarTitle,
  Textarea,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { Save20Regular } from "@fluentui/react-icons";
import { useNavigate } from "react-router";
import { formatBytes, formatDateTime } from "../../../shared/format";
import { ErrorState } from "../../../shared/components/ErrorState";
import { LoadingState } from "../../../shared/components/LoadingState";
import { PageHeader } from "../../../shared/components/PageHeader";
import { useFollow } from "../../../shared/navigation/useFollow";
import { useUnsavedChanges } from "../../../shared/navigation/UnsavedChanges";
import type { Skill } from "../api/skills.types";
import { useSkill } from "../hooks/useSkill";
import { useUpdateSkill } from "../hooks/useUpdateSkill";
import { SKILLS_PATH as LIST } from "../paths";
import { SkillResourcesCard } from "./SkillResources";

interface SkillEditorProps {
  id: string;
  readOnly: boolean;
}

// What the person typed, and the revision it was typed ON TOP OF. The revision
// is captured at the first keystroke and sent with the save, so a refetch that
// brings in somebody else's edit meanwhile cannot make this save overwrite it:
// the server compares and answers 409 instead.
interface Draft {
  content: string;
  revision: string;
}

const useStyles = makeStyles({
  body: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalM },
  meta: { color: tokens.colorNeutralForeground3, fontVariantNumeric: "tabular-nums" },
  // No soft wrap: in YAML a wrapped line looks exactly like an indented
  // continuation, so the editor would show a file shaped differently from the
  // one on disk. Long lines scroll sideways instead.
  code: { fontFamily: tokens.fontFamilyMonospace, fontSize: tokens.fontSizeBase200, lineHeight: tokens.lineHeightBase300, minHeight: "60vh", tabSize: 2, whiteSpace: "pre", overflowWrap: "normal", overflowX: "auto" },
});

export function SkillEditor({ id, readOnly }: SkillEditorProps) {
  const skill = useSkill(id);
  const [draft, setDraft] = useState<Draft | null>(null);
  const dirty = draft !== null && draft.content !== skill.data?.content;
  useUnsavedChanges(dirty);
  if (skill.isPending) return <Shell id={id} body={<LoadingState label={`Opening ${id}…`} />} />;
  if (skill.isError) return <Shell id={id} body={<ErrorState error={skill.error} title={`Could not open ${id}`} onRetry={() => skill.refetch()} />} />;
  return <Editing skill={skill.data} draft={draft} dirty={dirty} readOnly={readOnly} onDraft={setDraft} />;
}

function Trail({ id }: { id: string }) {
  const follow = useFollow();
  return (
    <Breadcrumb aria-label="Breadcrumb" size="small">
      <BreadcrumbItem>
        <BreadcrumbButton as="a" href={LIST} onClick={follow(LIST)}>
          Skills
        </BreadcrumbButton>
      </BreadcrumbItem>
      <BreadcrumbDivider />
      <BreadcrumbItem>
        <BreadcrumbButton current>{id}</BreadcrumbButton>
      </BreadcrumbItem>
    </Breadcrumb>
  );
}

function Shell({ id, body }: { id: string; body: ReactNode }) {
  const follow = useFollow();
  return (
    <>
      <PageHeader title={id} context={<Trail id={id} />} actions={<Button as="a" href={LIST} onClick={follow(LIST)}>Back to skills</Button>} />
      {body}
    </>
  );
}

interface EditingProps {
  skill: Skill;
  draft: Draft | null;
  dirty: boolean;
  readOnly: boolean;
  onDraft: (draft: Draft | null) => void;
}

function Editing({ skill, draft, dirty, readOnly, onDraft }: EditingProps) {
  const styles = useStyles();
  const update = useUpdateSkill();
  const navigate = useNavigate();
  const save = () => {
    if (!draft || !dirty || readOnly) return;
    update.mutate({ id: skill.id, content: draft.content, revision: draft.revision }, { onSuccess: () => onDraft(null) });
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (!(e.key === "s" && (e.ctrlKey || e.metaKey))) return;
    e.preventDefault();
    save();
  };
  return (
    <>
      <PageHeader
        title={skill.id}
        context={<Trail id={skill.id} />}
        badges={<StatusBadges skill={skill} dirty={dirty} />}
        description={<Caption1 className={styles.meta}>{metaOf(skill)}</Caption1>}
        actions={
          <>
            <Button appearance="primary" icon={<Save20Regular />} onClick={save} disabled={!dirty || readOnly || update.isPending}>
              {update.isPending ? "Saving…" : "Save"}
            </Button>
            <Button onClick={() => navigate(LIST)} disabled={update.isPending}>
              {dirty ? "Cancel" : "Close"}
            </Button>
          </>
        }
      />
      <div className={styles.body}>
        {readOnly && <ReadOnlyNotice />}
        {skill.problems.length > 0 && <ErrorState error={new ProblemsOnDisk(skill.problems)} title="This skill is currently invalid" />}
        {update.isError && <ErrorState error={update.error} title="Not saved — the file on disk is unchanged" />}
        {update.isSuccess && !dirty && <Saved />}
        <SkillResourcesCard id={skill.id} />
        <Field label="SKILL.md" hint="The whole file, frontmatter included. Ctrl+S / ⌘S saves.">
          <Textarea
            value={draft?.content ?? skill.content}
            onChange={(_, data) => onDraft({ content: data.value, revision: draft?.revision ?? skill.revision })}
            onKeyDown={onKeyDown}
            readOnly={readOnly}
            resize="vertical"
            textarea={{ className: styles.code, spellCheck: false, wrap: "off" }}
          />
        </Field>
      </div>
    </>
  );
}

const metaOf = (s: Skill) => `${s.userInvocable ? "User-invocable" : "Model-only"} · ${s.files} ${s.files === 1 ? "file" : "files"} · ${formatBytes(s.bytes)} · changed ${formatDateTime(s.modified)}`;

function StatusBadges({ skill, dirty }: { skill: Skill; dirty: boolean }) {
  return (
    <>
      {!skill.valid && (
        <Badge color="danger" appearance="tint">
          invalid
        </Badge>
      )}
      {dirty && (
        <Badge color="warning" appearance="tint">
          Unsaved changes
        </Badge>
      )}
    </>
  );
}

// The problems the server found in the file AS IT IS on disk, shown the way a
// refused save shows its own -- one sentence per problem.
class ProblemsOnDisk extends Error {
  readonly details: string[];
  constructor(problems: string[]) {
    super("The SKILL.md on disk does not hold to the skill contract.");
    this.details = problems;
  }
}

function Saved() {
  return (
    <MessageBar intent="success">
      <MessageBarBody>Saved.</MessageBarBody>
    </MessageBar>
  );
}

function ReadOnlyNotice() {
  return (
    <MessageBar intent="warning" layout="multiline">
      <MessageBarBody>
        <MessageBarTitle>Read-only</MessageBarTitle>
        This tab has no mutation token. Open the URL control-server printed at start-up to edit or delete skills.
      </MessageBarBody>
    </MessageBar>
  );
}
