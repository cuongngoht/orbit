// "DRAFT WITH AI" (ADR 0062): the CEO drafts one profile for the form the owner is filling -- Hire, or an employee's
// profile -- from a few words about the job. The practice it follows:
//   - the owner stays in control: the draft only fills the form (nothing is hired, nothing saved, until the owner does
//     it); empty fields are filled at once, fields the owner already wrote are replaced only after "Replace what you
//     wrote?", and Undo puts back what was there;
//   - it says where the words came from ("Drafted by <CEO>: read it before you go on"), written in the owner's language;
//   - it touches only what describes the person (title, duties, instructions, skills, languages, handoff standard) --
//     never what the owner decides elsewhere: runtime, model, resources, delegation or probation;
//   - its state is visible: the CEO drafting (with Stop) or waiting (and why), a draft that failed (and why); with no CEO
//     to ask the button is off and says why -- the templates still work.
import { Button, Field, Link, MessageBar, MessageBarBody, Spinner, Text, Textarea, makeStyles, tokens } from "@fluentui/react-components";
import { Sparkle20Regular } from "@fluentui/react-icons";
import { DRAFT_LIMITS, type ExecutiveState, type ExecutiveTurn, type ProfileDraft, type ProfileDraftAccepted, type ProfileDraftView } from "@orbit-web/contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "../../i18n";
import { errorText, newIdempotencyKey } from "../../services/api";
import { executive } from "../executive/api";
import { useOfficeStyles } from "./parts";

const useStyles = makeStyles({
  box: { display: "flex", flexDirection: "column", gap: "8px", padding: "12px", borderRadius: tokens.borderRadiusLarge, backgroundColor: tokens.colorNeutralBackground2, minWidth: 0 },
  actions: { display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" },
});

// What the form holds, as the form holds it (lists as "a, b, c").
export interface DraftFields {
  title: string;
  duties: string;
  instructions: string;
  skills: string;
  languages: string;
  handoffStandard: string;
}

const KEYS = ["title", "duties", "instructions", "skills", "languages", "handoffStandard"] as const satisfies readonly (keyof DraftFields)[];
const POLL_MS = 1500;

const asFields = (d: ProfileDraft): DraftFields => ({ title: d.title, duties: d.duties, instructions: d.instructions, skills: d.skills.join(", "), languages: d.languages.join(", "), handoffStandard: d.handoffStandard });

// The form with the draft in it: every field the owner left empty, or -- once the owner says so -- every field the draft
// writes (a title the owner wrote is always kept: it names the role the draft was asked for).
export function filled(form: DraftFields, draft: DraftFields, replace: boolean): DraftFields {
  const next = { ...form };
  for (const k of KEYS) {
    const empty = form[k].trim().length === 0;
    if (draft[k].trim().length > 0 && (empty || (replace && k !== "title"))) next[k] = draft[k];
  }
  return next;
}

// What the owner wrote that the draft would replace.
const written = (form: DraftFields, draft: DraftFields): (keyof DraftFields)[] => KEYS.filter((k) => k !== "title" && form[k].trim().length > 0 && draft[k].trim().length > 0 && form[k].trim() !== draft[k].trim());

export function DraftWithAi({ form, departmentId, departmentName, state, onFill }: { form: DraftFields; departmentId: string | null; departmentName: string | null; state: ExecutiveState | null; onFill: (next: DraftFields) => void }) {
  const { t } = useI18n();
  const s = useStyles();
  const o = useOfficeStyles();
  const ceo = state?.ceo?.name ?? t("office.draft.theCeo");
  const can = state?.converse.ok === true;
  const [open, setOpen] = useState(false);
  const [description, setDescription] = useState("");
  const [sent, setSent] = useState<ProfileDraftAccepted | null>(null);
  const [view, setView] = useState<ProfileDraftView | null>(null);
  const [turn, setTurn] = useState<ExecutiveTurn | null>(null);
  const [asking, setAsking] = useState<DraftFields | null>(null);
  const [before, setBefore] = useState<DraftFields | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  // The form as it is now, for a draft that arrives while the owner keeps typing.
  const latest = useRef({ form, onFill });
  useEffect(() => {
    latest.current = { form, onFill };
  });

  // A draft that arrived fills the form: at once when it replaces nothing the owner wrote, else once the owner says how.
  const arrive = useCallback((draft: DraftFields): void => {
    const now = latest.current.form;
    if (written(now, draft).length > 0) {
      setAsking(draft);
      return;
    }
    setBefore(now);
    setOpen(false);
    latest.current.onFill(filled(now, draft, false));
  }, []);

  // While the CEO drafts, the draft (and its turn: waiting, and why) is read again; its end stops the reading.
  useEffect(() => {
    if (sent === null) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const loop = async (): Promise<void> => {
      try {
        const v = await executive.draftOf(sent.draftId);
        if (stopped) return;
        setView(v);
        if (v.state !== "drafting") {
          setSent(null);
          if (v.draft !== null) arrive(asFields(v.draft));
          return;
        }
        const d = await executive.conversation(sent.conversationId);
        if (!stopped) setTurn(d.turns.find((x) => x.id === sent.turn.id) ?? null);
      } catch (err) {
        if (!stopped) setProblem(errorText(err));
      }
      if (!stopped) timer = setTimeout(() => void loop(), POLL_MS);
    };
    void loop();
    return () => {
      stopped = true;
      if (timer !== null) clearTimeout(timer);
    };
  }, [sent, arrive]);

  const apply = (next: DraftFields) => {
    setBefore(form);
    setAsking(null);
    setOpen(false);
    onFill(next);
  };
  const start = () => {
    setDescription(form.title.trim().length > 0 ? `${form.title.trim()}${departmentName ? ` — ${departmentName}` : ""}` : "");
    setOpen(true);
    setProblem(null);
  };
  const generate = async () => {
    setProblem(null);
    setView(null);
    setTurn(null);
    try {
      setSent(await executive.draft({ description: description.trim(), title: form.title.trim(), departmentId }, newIdempotencyKey()));
    } catch (err) {
      setProblem(errorText(err));
    }
  };
  const stop = async () => {
    if (sent === null) return;
    try {
      await executive.stop(sent.conversationId, sent.turn.id);
    } catch (err) {
      setProblem(errorText(err));
    }
  };

  const drafting = sent !== null;
  const waiting = turn?.state === "waiting" || turn?.state === "queued";
  return (
    <div className={s.box} role="group" aria-label={t("office.draft.groupLabel")}>
      <div className={o.between}>
        <Text size={200} className={o.muted}>
          {t("office.draft.lead")}
        </Text>
        <Button size="small" icon={<Sparkle20Regular />} disabled={!can || drafting} title={!can ? (state?.converse.reason ?? t("office.draft.noCeo")) : undefined} onClick={start}>
          {t("office.draft.button")}
        </Button>
      </div>
      {open && !drafting && asking === null && (
        <>
          <Field label={t("office.draft.describeLabel")} hint={t("office.draft.describeHint", { ceo })}>
            <Textarea value={description} rows={3} resize="vertical" maxLength={DRAFT_LIMITS.descriptionLength} placeholder={t("office.draft.describePlaceholder")} onChange={(_, d) => setDescription(d.value)} />
          </Field>
          <div className={s.actions}>
            <Button appearance="primary" size="small" disabled={description.trim().length === 0} onClick={() => void generate()}>
              {t("office.draft.generate")}
            </Button>
            <Button size="small" onClick={() => setOpen(false)}>
              {t("office.draft.cancel")}
            </Button>
          </div>
        </>
      )}
      {drafting && (
        <div className={s.actions} role="status" aria-live="polite">
          <Spinner size="tiny" />
          <Text size={200}>{waiting ? t("office.draft.waiting", { ceo }) : t("office.draft.drafting", { ceo })}</Text>
          {waiting && turn?.waitingReason && (
            <Text size={200} className={o.muted}>
              {turn.waitingReason}
            </Text>
          )}
          <Button size="small" onClick={() => void stop()}>
            {t("office.draft.stop")}
          </Button>
        </div>
      )}
      {asking !== null && (
        <MessageBar intent="warning">
          <MessageBarBody>
            <Text>{t("office.draft.replaceAsk", { ceo })}</Text>
            <div className={s.actions}>
              <Button size="small" appearance="primary" onClick={() => apply(filled(form, asking, true))}>
                {t("office.draft.replace")}
              </Button>
              <Button size="small" onClick={() => apply(filled(form, asking, false))}>
                {t("office.draft.fillEmpty")}
              </Button>
              <Button size="small" onClick={() => setAsking(null)}>
                {t("office.draft.discard")}
              </Button>
            </div>
          </MessageBarBody>
        </MessageBar>
      )}
      {before !== null && asking === null && !drafting && (
        <div className={s.actions} role="status">
          <Text size={200}>{t("office.draft.drafted", { ceo })}</Text>
          <Link
            as="button"
            onClick={() => {
              onFill(before);
              setBefore(null);
            }}
          >
            {t("office.draft.undo")}
          </Link>
        </div>
      )}
      {view?.state === "failed" && !drafting && (
        <MessageBar intent="warning">
          <MessageBarBody>{`${t("office.draft.failed")} ${view.problems.join(" ")}`}</MessageBarBody>
        </MessageBar>
      )}
      {problem !== null && (
        <MessageBar intent="error">
          <MessageBarBody>{problem}</MessageBarBody>
        </MessageBar>
      )}
    </div>
  );
}
