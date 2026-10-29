import type { ReactNode } from "react";
import { Badge, Button, Caption1, Checkbox, Field, Input, Link, MessageBar, MessageBarBody, Text, makeStyles, tokens } from "@fluentui/react-components";
import { ApiError, mutationToken } from "../../shared/api/client";
import { ErrorState } from "../../shared/components/ErrorState";
import { useFollow } from "../../shared/navigation/useFollow";
import { useTools } from "../tools/tools.api";
import { toolPath } from "../tools/toolWords";
import { sessionView, sourceWords } from "./authWords";
import type { SessionView, Words } from "./authWords";
import { connectionsApi, useConnectionChange } from "./connections.api";
import type { AuthOption, AuthOptions, AuthRun, AuthStrategy, AuthTool, Connection } from "./connections.types";
import { choiceOf, optionsOfChoice } from "./connectionWords";

const useStyles = makeStyles({
  stack: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalM },
  form: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(14rem, 1fr))", gap: tokens.spacingHorizontalL, alignItems: "start" },
  facts: { display: "grid", gridTemplateColumns: "auto 1fr", columnGap: tokens.spacingHorizontalXL, rowGap: tokens.spacingVerticalS, margin: 0 },
  dd: { margin: 0, display: "flex", gap: tokens.spacingHorizontalS, alignItems: "baseline", flexWrap: "wrap" },
  actions: { display: "flex", gap: tokens.spacingHorizontalS, flexWrap: "wrap", alignItems: "center" },
  muted: { color: tokens.colorNeutralForeground3 },
  // A checkbox's description sits under it, in line with its label.
  checkbox: { display: "flex", flexDirection: "column" },
  hint: { color: tokens.colorNeutralForeground3, marginInlineStart: "1.75rem" },
  tried: { margin: 0, paddingLeft: tokens.spacingHorizontalL },
});

const ASKED: Record<AuthRun["action"], string> = { check: "The check did not finish", "sign-in": "The sign-in did not finish", "sign-out": "The sign-out did not finish" };

interface Props {
  connection: Connection;
  strategy: AuthStrategy;
  /** The options as drafted: what the fields show. */
  options: AuthOptions;
  /** What is wrong with a drafted option, by option name, held to the descriptor's own pattern. */
  problems: Record<string, string>;
  /** The draft is not what is saved. A look and a move act on what is SAVED, so none is offered until it is. */
  dirty: boolean;
  onOption: (name: string, value: string | boolean) => void;
}

// A connection that signs in: the options its strategy declares, how the session stands, and the three things a person does about it.
// The sign-in itself happens in their browser. What this page is told is how it ENDED: the prompt the program prints (a link, a
// code) is shown in the terminal Orbit Control runs in, and no token is ever sent here, held here or shown.
export function SignInPanel({ connection, strategy, options, problems, dirty, onOption }: Props) {
  const styles = useStyles();
  const run = useConnectionChange((r: AuthRun) => connectionsApi.auth(connection.id, r));
  const view = sessionView(run.data, run.error);
  const asking = run.isPending ? run.variables?.action : undefined;
  const unavailable = !mutationToken() || run.isPending || dirty || Object.keys(problems).length > 0;
  const signedIn = run.data?.state === "authenticated";
  const signedOut = view.missing || run.data?.state === "sign-in-required";
  const move = (r: AuthRun) => run.mutate(r);
  return (
    <div className={styles.stack}>
      {(strategy.options?.length ?? 0) > 0 && (
        <div className={styles.form}>
          {strategy.options?.map((o) => (
            <OptionField key={o.name} option={o} value={options[o.name]} problem={problems[o.name]} onChange={(v) => onOption(o.name, v)} />
          ))}
        </div>
      )}
      {strategy.interactive && (
        <MessageBar intent="info" layout="multiline">
          <MessageBarBody>The sign-in itself happens in your browser. Orbit Control only reports how it ended: if the program prints a link or a code, it appears in the terminal where Orbit Control is running, not on this page.</MessageBarBody>
        </MessageBar>
      )}
      <Facts connection={connection} strategy={strategy} view={view} />
      {view.missing && <GettingTheProgram strategy={strategy} tool={view.tool} />}
      {run.isError && <MoveError error={run.error} action={run.variables?.action ?? "check"} />}
      <div className={styles.actions}>
        <Button disabled={unavailable} onClick={() => move({ action: "check" })}>
          {asking === "check" ? "Checking…" : "Check"}
        </Button>
        <Button appearance="primary" disabled={unavailable} onClick={() => move({ action: "sign-in", options: optionsOfChoice(choiceOf(strategy, options)) })}>
          {asking === "sign-in" ? "Waiting for the sign-in…" : signedIn ? "Re-authenticate" : "Sign in"}
        </Button>
        <Button disabled={unavailable || signedOut} onClick={() => move({ action: "sign-out" })}>
          {asking === "sign-out" ? "Signing out…" : "Sign out"}
        </Button>
        {asking === "sign-in" && <Caption1 role="status">Finish the sign-in in your browser. This page waits until the program reports how it ended.</Caption1>}
        {dirty && <Caption1 className={styles.muted}>Save your change first: Check, Sign in and Sign out act on what is saved.</Caption1>}
      </div>
    </div>
  );
}

// A move that could not go on, in the engine's own words. A sign-in waits for a person, and a browser may give up on a request that
// waits that long: the page then lost its connection, which says nothing about how the sign-in ended, so it says that instead of
// "the server could not be reached" -- which would send a person to look at a server that is fine.
function MoveError({ error, action }: { error: unknown; action: AuthRun["action"] }) {
  if (!(error instanceof ApiError && error.status === 0 && action === "sign-in")) return <ErrorState error={error} title={ASKED[action]} />;
  return (
    <MessageBar intent="warning" layout="multiline">
      <MessageBarBody>The page lost its connection to Orbit Control while it waited for the sign-in. The sign-in may well have finished: press Check to see how the session stands.</MessageBarBody>
    </MessageBar>
  );
}

// An option is drawn from its row in the descriptor: a boolean is a checkbox, anything else is text held to the pattern it declares.
function OptionField({ option, value, problem, onChange }: { option: AuthOption; value: string | boolean | undefined; problem: string | undefined; onChange: (value: string | boolean) => void }) {
  const styles = useStyles();
  if (option.type === "boolean")
    return (
      <div className={styles.checkbox}>
        <Checkbox label={option.label} checked={value === true} onChange={(_, d) => onChange(d.checked === true)} />
        {option.doc && <Caption1 className={styles.hint}>{option.doc}</Caption1>}
      </div>
    );
  return (
    <Field label={option.label} hint={option.doc} validationMessage={problem} validationState={problem ? "error" : undefined}>
      <Input value={typeof value === "string" ? value : ""} onChange={(_, d) => onChange(d.value)} />
    </Field>
  );
}

// The program, the sign-in, whether the source accepted it, and who keeps the session.
function Facts({ connection, strategy, view }: { connection: Connection; strategy: AuthStrategy; view: SessionView }) {
  const styles = useStyles();
  return (
    <dl className={styles.facts}>
      <Fact name="Program">{view.program ? <Said words={view.program} /> : <Text>Not reported by the last move.</Text>}</Fact>
      <Fact name="Sign-in">{view.signIn ? <Said words={view.signIn} /> : <Text>Not until the program is here.</Text>}</Fact>
      <Fact name="Source">
        <Text>{sourceWords(connection.lastTest)}</Text>
      </Fact>
      <Fact name="Session owner">
        <Text>{strategy.sessionOwner ?? "—"}</Text>
        <Caption1 className={styles.muted}>A profile Orbit keeps for itself, never the account you use in your own terminal.</Caption1>
      </Fact>
    </dl>
  );
}

function Fact({ name, children }: { name: string; children: ReactNode }) {
  const styles = useStyles();
  return (
    <div style={{ display: "contents" }}>
      <dt>
        <Text weight="semibold">{name}</Text>
      </dt>
      <dd className={styles.dd}>{children}</dd>
    </div>
  );
}

function Said({ words }: { words: Words }) {
  const styles = useStyles();
  return (
    <>
      <Badge appearance="tint" color={words.tone}>
        {words.label}
      </Badge>
      {words.says && <Caption1 className={styles.muted}>{words.says}</Caption1>}
    </>
  );
}

// Where to get the program, from the Tools catalog the strategy names: Orbit's own copy when it may fetch one, else the instructions.
function GettingTheProgram({ strategy, tool }: { strategy: AuthStrategy; tool: AuthTool | undefined }) {
  const styles = useStyles();
  const follow = useFollow();
  const tools = useTools();
  const rows = (strategy.tools ?? []).flatMap((id) => tools.data?.find((t) => t.id === id) ?? []);
  const own = tool?.acquirable ?? null;
  const instructions = rows.map((t) => t.install.instructions).find(Boolean);
  return (
    <MessageBar intent="warning" layout="multiline">
      <MessageBarBody>
        {own ? (
          <>
            Orbit can install its own copy of the program. It does so by itself the first time a sign-in needs one; to do it now,{" "}
            <Link href={toolPath(own)} onClick={follow(toolPath(own))}>
              install it from Tools
            </Link>
            .
          </>
        ) : (
          <>
            Orbit cannot install its own copy of the program on this machine. {instructions}
          </>
        )}
        {tool && tool.tried.length > 0 && (
          <ul className={styles.tried} aria-label="Looked for">
            {tool.tried.map((t) => (
              <li key={t.id}>
                {t.id}
                {t.reason ? ` — ${t.reason}` : ""}
              </li>
            ))}
          </ul>
        )}
      </MessageBarBody>
    </MessageBar>
  );
}
