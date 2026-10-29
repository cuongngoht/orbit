import { useState } from "react";
import { Badge, Button, Caption1, Link, Radio, RadioGroup, makeStyles, tokens } from "@fluentui/react-components";
import { mutationToken } from "../../shared/api/client";
import { Card } from "../../shared/components/Card";
import { ErrorState } from "../../shared/components/ErrorState";
import { connectionsApi, useConnectionChange } from "./connections.api";
import type { AuthOptions, AuthStrategy, Connection, Provider } from "./connections.types";
import { choiceOf, docLabel, optionProblem, optionsOfChoice, sameChoice, strategiesOf } from "./connectionWords";
import { CredentialControls } from "./CredentialControls";
import { SignInPanel } from "./SignInPanel";

const useStyles = makeStyles({
  stack: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalM },
  choice: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalXXS, paddingBlock: tokens.spacingVerticalXS },
  head: { display: "flex", alignItems: "center", gap: tokens.spacingHorizontalS },
  doc: { color: tokens.colorNeutralForeground3, marginInlineStart: "1.75rem" },
  actions: { display: "flex", gap: tokens.spacingHorizontalS, flexWrap: "wrap", alignItems: "center" },
  muted: { color: tokens.colorNeutralForeground3 },
});

interface Draft {
  strategy: string;
  options: AuthOptions;
}

const savedDraft = (connection: Connection): Draft => ({ strategy: connection.auth.strategy, options: optionsOfChoice(connection.auth) });

// HOW this connection gets in, from what the provider's descriptor offers -- one way per strategy, the recommended one marked -- with
// the options of the chosen one, drawn from the descriptor's own rows, and what a person does about it: a credential is stored once
// and never shown again; a sign-in keeps no credential at all, only a session a program holds, which is looked at, signed in and out
// of here. Nothing a person types is sent until they press a button, and no token and no credential value is ever held by this page
// beyond the moment it is sent.
export function AuthenticationCard({ connection, provider, backend }: { connection: Connection; provider: Provider | undefined; backend: string | null }) {
  const styles = useStyles();
  const strategies = strategiesOf(provider);
  const [draft, setDraft] = useState<Draft>(() => savedDraft(connection));
  const chosen = strategies.find((s) => s.id === draft.strategy) ?? strategies[0];
  const choice = choiceOf(chosen, draft.options);
  const dirty = !sameChoice(choice, connection.auth);
  const problems = problemsOf(chosen, draft.options);
  const save = useConnectionChange(() => connectionsApi.update(connection.id, { auth: choice }));
  const choose = (id: string) => setDraft({ strategy: id, options: id === connection.auth.strategy ? optionsOfChoice(connection.auth) : {} });
  const setOption = (name: string, value: string | boolean) => setDraft((d) => ({ ...d, options: { ...d.options, [name]: value } }));
  const choosable = strategies.length > 1 || (chosen.options?.length ?? 0) > 0;
  return (
    <Card title="Authentication" subtitle={`How Orbit gets in to ${provider?.label ?? "this source"}.`}>
      {strategies.length > 1 && <Choices strategies={strategies} chosen={chosen.id} onChoose={choose} />}
      <div className={styles.stack}>
        {chosen.doc && strategies.length === 1 && <Caption1 className={styles.muted}>{chosen.doc}</Caption1>}
        <Documents strategy={chosen} />
        {chosen.kind === "credential" ? <CredentialControls connection={connection} provider={provider} backend={backend} /> : <SignInPanel key={JSON.stringify(connection.auth)} connection={connection} strategy={chosen} options={draft.options} problems={problems} dirty={dirty} onOption={setOption} />}
      </div>
      {choosable && (
        <div className={styles.actions}>
          <Button appearance="primary" disabled={!mutationToken() || !dirty || save.isPending || Object.keys(problems).length > 0} onClick={() => save.mutate(undefined)}>
            {save.isPending ? "Saving…" : "Save"}
          </Button>
          {dirty && <Caption1 className={styles.muted}>Not saved yet: the connection still gets in the way it did.</Caption1>}
          {save.isSuccess && !dirty && <Caption1>Saved.</Caption1>}
        </div>
      )}
      {save.isError && <ErrorState error={save.error} title="Not saved" />}
    </Card>
  );
}

function problemsOf(strategy: AuthStrategy, options: AuthOptions): Record<string, string> {
  return Object.fromEntries(
    (strategy.options ?? []).flatMap((o) => {
      const problem = optionProblem(o, options[o.name]);
      return problem ? [[o.name, problem] as const] : [];
    }),
  );
}

// One way in per strategy, in the descriptor's order. The one it prefers is the recommended one; every other is an alternative.
function Choices({ strategies, chosen, onChoose }: { strategies: AuthStrategy[]; chosen: string; onChoose: (id: string) => void }) {
  const styles = useStyles();
  const marked = strategies.some((s) => s.preferred);
  return (
    <RadioGroup value={chosen} onChange={(_, d) => onChoose(d.value)} aria-label="How Orbit gets in">
      {strategies.map((s) => (
        <div key={s.id} className={styles.choice}>
          <div className={styles.head}>
            <Radio value={s.id} label={s.label} />
            {marked && (
              <Badge appearance="tint" color={s.preferred ? "success" : "informative"}>
                {s.preferred ? "Recommended" : "Alternative"}
              </Badge>
            )}
          </div>
          {s.doc && <Caption1 className={styles.doc}>{s.doc}</Caption1>}
        </div>
      ))}
    </RadioGroup>
  );
}

// The official pages a strategy points to.
function Documents({ strategy }: { strategy: AuthStrategy }) {
  const docs = strategy.docs ?? [];
  if (!docs.length) return null;
  return (
    <Caption1>
      {docs.map((d, i) => (
        <span key={d}>
          {i > 0 && " · "}
          <Link href={d} target="_blank" rel="noreferrer noopener">
            {docLabel(d)}
          </Link>
        </span>
      ))}
    </Caption1>
  );
}
