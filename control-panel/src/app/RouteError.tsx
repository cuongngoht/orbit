import { Body1, Button, Caption1, Link, Title2, makeStyles, tokens } from "@fluentui/react-components";
import { isRouteErrorResponse, useRouteError } from "react-router";

const useStyles = makeStyles({
  root: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalM, maxWidth: "46rem" },
  detail: { color: tokens.colorNeutralForeground3, fontFamily: tokens.fontFamilyMonospace, overflowWrap: "anywhere" },
  actions: { display: "flex", gap: tokens.spacingHorizontalM, alignItems: "center" },
});

// What a page that failed to render shows, INSIDE the shell -- the sidebar and
// the top bar stay, so one broken page never takes the whole panel with it.
// The error's own message is shown as it is: it comes from this page's code,
// not from a server, and it is what a bug report needs.
export function RouteError() {
  const styles = useStyles();
  const error = useRouteError();
  return (
    <section className={styles.root} role="alert">
      <Title2 as="h1">This page could not be shown</Title2>
      <Body1>Something on this page failed while it was being drawn. Nothing was changed on the server by it. Reload to try again; if it happens again, the line below is what to report.</Body1>
      <Caption1 className={styles.detail}>{messageOf(error)}</Caption1>
      <div className={styles.actions}>
        <Button appearance="primary" onClick={() => window.location.reload()}>
          Reload
        </Button>
        <Link href="/">Back to Orbit Control</Link>
      </div>
    </section>
  );
}

function messageOf(error: unknown): string {
  if (isRouteErrorResponse(error)) return `${error.status} ${error.statusText}`;
  if (error instanceof Error) return error.message;
  return "an unknown error";
}
