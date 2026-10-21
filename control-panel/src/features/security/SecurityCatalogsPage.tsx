import { useState } from "react";
import { Badge, Button, Caption1, Checkbox, Field, Input, MessageBar, MessageBarBody, Select, Textarea, makeStyles, tokens } from "@fluentui/react-components";
import { ArrowClockwise20Regular } from "@fluentui/react-icons";
import { useQueryClient } from "@tanstack/react-query";
import { mutationToken } from "../../shared/api/client";
import { Card } from "../../shared/components/Card";
import { ErrorState } from "../../shared/components/ErrorState";
import { LoadingState } from "../../shared/components/LoadingState";
import { PageHeader } from "../../shared/components/PageHeader";
import { securityApi, securityKeys, useCatalogDocument, useSecurityChange, useSecurityOverview } from "./security.api";
import type { CatalogListed, CatalogSource, Enabled, Preview, SecurityOverview } from "./security.types";
import { jsonOrProblem, pinOf } from "./securityWords";

const useStyles = makeStyles({
  stack: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalL },
  row: { display: "flex", gap: tokens.spacingHorizontalS, alignItems: "end", flexWrap: "wrap" },
  list: { margin: 0, paddingLeft: tokens.spacingHorizontalL },
  code: { fontFamily: tokens.fontFamilyMonospace, minHeight: "10rem" },
});

// `/security`: the security catalogs a PERSON chooses (ADR 0040) -- what Orbit ships, what was adopted on this machine,
// which catalogs this project is held to and which controls do not apply here. This page is the only place a catalog is
// fetched, adopted, written, enabled or marked; nothing here runs an assessment, which is the auditor's, from evidence.
export function SecurityCatalogsPage() {
  const client = useQueryClient();
  const view = useSecurityOverview();
  return (
    <>
      <PageHeader
        title="Security catalogs"
        description="The standards and policies this project is held to: Orbit's default, a catalog you add by link or file, or one you write — enabled per project, with the controls that do not apply here and why."
        actions={<Button icon={<ArrowClockwise20Regular />} onClick={() => client.invalidateQueries({ queryKey: securityKeys.all })}>Refresh</Button>}
      />
      {view.isPending && <LoadingState label="Reading the security catalogs…" />}
      {view.isError && <ErrorState error={view.error} title="Could not read the security catalogs" onRetry={() => view.refetch()} />}
      {view.data && <Catalogs key={`${view.data.index.revision ?? "none"}-${view.data.project.revision ?? "none"}`} view={view.data} />}
    </>
  );
}

function Catalogs({ view }: { view: SecurityOverview }) {
  const styles = useStyles();
  return (
    <div className={styles.stack}>
      <InEffectCard view={view} />
      <AddCard view={view} />
      {view.project.available ? <EnableCard view={view} /> : <MessageBar intent="info"><MessageBarBody>Start Orbit Control from the project's checkout to choose which catalogs it follows.</MessageBarBody></MessageBar>}
      {view.project.available && <MarkCard view={view} />}
    </div>
  );
}

function InEffectCard({ view }: { view: SecurityOverview }) {
  const styles = useStyles();
  const e = view.project.effective;
  return (
    <Card title="In effect" subtitle={e.by === "default" ? "Orbit's default: this project has enabled no catalog." : "The catalogs this project enabled, each pinned by digest."}>
      <ul className={styles.list}>
        {e.catalogs.map((c) => <li key={c.digest}>{pinOf(c)} — {c.controls} control(s){c.filter ? ` · filtered ${JSON.stringify(c.filter)}` : ""}</li>)}
      </ul>
      {e.missing.map((m) => <MessageBar key={m.digest} intent="warning"><MessageBarBody>{m.catalog}: {m.why}</MessageBarBody></MessageBar>)}
      {view.refused.map((r) => <MessageBar key={r.from} intent="error"><MessageBarBody>{r.from} was refused: {r.problems.slice(0, 3).join("; ")}</MessageBarBody></MessageBar>)}
    </Card>
  );
}

// Add a catalog: preview a link or a document first; what is adopted is exactly what was previewed.
function AddCard({ view }: { view: SecurityOverview }) {
  const styles = useStyles();
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [shown, setShown] = useState<{ source: CatalogSource; preview: Preview } | null>(null);
  const preview = useSecurityChange((source: CatalogSource) => securityApi.preview(source).then((r) => setShown({ source, preview: r.preview })));
  const adopt = useSecurityChange(() => (shown?.preview.digest ? securityApi.adopt(shown.source, shown.preview.digest, view.index.revision) : Promise.resolve(null)));
  const written = jsonOrProblem(text);
  const save = useSecurityChange(() => securityApi.saveEditor(written.value, view.index.revision));
  return (
    <Card title="Add a catalog" subtitle="By its https link, or pasted or written here. Nothing is kept until you adopt what the preview shows.">
      <div className={styles.row}>
        <Field label="Link (https)"><Input value={url} onChange={(_, d) => setUrl(d.value)} /></Field>
        <Button disabled={!url || preview.isPending} onClick={() => preview.mutate({ url })}>Preview link</Button>
      </div>
      <Field label="Catalog document (JSON)" validationMessage={text && written.problem ? `Not JSON: ${written.problem}` : undefined}>
        <Textarea className={styles.code} value={text} onChange={(_, d) => setText(d.value)} />
      </Field>
      <div className={styles.row}>
        <Button disabled={!text || written.problem !== null || preview.isPending} onClick={() => preview.mutate({ text })}>Preview document</Button>
        <Button disabled={!mutationToken() || !text || written.problem !== null || save.isPending} onClick={() => save.mutate(undefined)}>Save as written</Button>
      </div>
      {shown && <PreviewShown preview={shown.preview} />}
      {shown?.preview.ok && <Button appearance="primary" disabled={!mutationToken() || adopt.isPending} onClick={() => adopt.mutate(undefined)}>Adopt {shown.preview.catalog} {shown.preview.version}</Button>}
      {adopt.isSuccess && <Caption1>Adopted.</Caption1>}
      {save.isSuccess && <Caption1>Saved.</Caption1>}
      {[preview, adopt, save].map((m, i) => m.isError && <ErrorState key={i} error={m.error} title="The catalog was not taken" />)}
    </Card>
  );
}

function PreviewShown({ preview }: { preview: Preview }) {
  if (!preview.ok) return <MessageBar intent="error"><MessageBarBody>It does not hold: {preview.problems.slice(0, 6).join("; ")}</MessageBarBody></MessageBar>;
  const d = preview.diff ?? { added: [], removed: [], changed: [] };
  return (
    <MessageBar intent="info" layout="multiline">
      <MessageBarBody>
        {preview.title} — {preview.controls} control(s), digest {preview.digest?.slice(0, 12)}.{" "}
        {preview.against ? `Against ${preview.against.version}: ${d.added.length} added, ${d.removed.length} removed, ${d.changed.length} changed.` : "New on this machine."}
      </MessageBarBody>
    </MessageBar>
  );
}

const known = (view: SecurityOverview): CatalogListed[] => [...view.shipped, ...view.adopted];

function EnableCard({ view }: { view: SecurityOverview }) {
  const [enabled, setEnabled] = useState<Enabled[]>(view.project.enabled);
  const save = useSecurityChange(() => securityApi.enable(enabled, view.project.revision));
  const toggle = (c: CatalogListed, on: boolean) => setEnabled(on ? [...enabled.filter((e) => e.catalog !== c.catalog), { catalog: c.catalog, digest: c.digest }] : enabled.filter((e) => e.digest !== c.digest));
  return (
    <Card title="This project follows" subtitle="One version of a catalog at a time. With none enabled, Orbit's default is in effect.">
      {known(view).map((c) => <Checkbox key={c.digest} label={`${pinOf(c)} — ${c.title}`} checked={enabled.some((e) => e.digest === c.digest)} onChange={(_, d) => toggle(c, d.checked === true)} />)}
      <Button appearance="primary" disabled={!mutationToken() || save.isPending} onClick={() => save.mutate(undefined)}>Save</Button>
      {save.isSuccess && <Caption1>Saved.</Caption1>}
      {save.isError && <ErrorState error={save.error} title="The catalogs were not saved" />}
    </Card>
  );
}

function MarkCard({ view }: { view: SecurityOverview }) {
  const styles = useStyles();
  const [digest, setDigest] = useState(view.project.effective.catalogs[0]?.digest ?? "");
  const [control, setControl] = useState("");
  const [why, setWhy] = useState("");
  const doc = useCatalogDocument(digest || null);
  const catalog = known(view).find((c) => c.digest === digest)?.catalog ?? "";
  const mark = useSecurityChange((m: { control: string; why?: string; clear?: boolean }) => securityApi.mark({ catalog, ...m }, view.project.revision));
  return (
    <Card title="Not applicable here" subtitle="A control marked here is not-applicable for this project, with your reason. Anything else that does not apply must be shown by the system's graph.">
      <ul className={styles.list}>
        {view.project.notApplicable.map((m) => <li key={`${m.catalog}-${m.control}`}>{m.catalog} {m.control} — {m.why} <Button size="small" disabled={!mutationToken()} onClick={() => mark.mutate({ control: m.control, clear: true })}>Take back</Button></li>)}
      </ul>
      <div className={styles.row}>
        <Field label="Catalog"><Select value={digest} onChange={(_, d) => setDigest(d.value)}>{known(view).map((c) => <option key={c.digest} value={c.digest}>{pinOf(c)}</option>)}</Select></Field>
        <Field label="Control"><Select value={control} onChange={(_, d) => setControl(d.value)}><option value="">—</option>{(doc.data?.document.controls ?? []).map((c) => <option key={c.id} value={c.id}>{c.id}</option>)}</Select></Field>
        <Field label="Why it does not apply"><Input value={why} onChange={(_, d) => setWhy(d.value)} /></Field>
        <Button disabled={!mutationToken() || !control || !why.trim() || mark.isPending} onClick={() => mark.mutate({ control, why })}>Mark not applicable</Button>
      </div>
      {mark.isError && <ErrorState error={mark.error} title="The mark was not saved" />}
      {view.project.notApplicable.length > 0 && <Badge appearance="tint">{view.project.notApplicable.length} marked</Badge>}
    </Card>
  );
}
