import { Button, MessageBar, MessageBarBody, makeStyles, tokens } from "@fluentui/react-components";
import { ArrowClockwise20Regular } from "@fluentui/react-icons";
import { useQueryClient } from "@tanstack/react-query";
import { Link as RouterLink } from "react-router";
import { ErrorState } from "../../shared/components/ErrorState";
import { LoadingState } from "../../shared/components/LoadingState";
import { PageHeader } from "../../shared/components/PageHeader";
import { PROJECTS_PATH } from "../projects/projectWords";
import { CheckoutPicker } from "./CheckoutPicker";
import { StateBadge } from "./StateBadge";
import { ComponentsCard } from "./cards/ComponentsCard";
import { ConnectivityCard } from "./cards/ConnectivityCard";
import { EnvironmentCard } from "./cards/EnvironmentCard";
import { HostCard } from "./cards/HostCard";
import { OsCard } from "./cards/OsCard";
import { SandboxPolicyCard } from "./cards/SandboxPolicyCard";
import { SandboxesCard } from "./cards/SandboxesCard";
import { SessionsCard } from "./cards/SessionsCard";
import { SettingsCard } from "./cards/SettingsCard";
import { UnderstandingCard } from "./cards/UnderstandingCard";
import { VerificationCard } from "./cards/VerificationCard";
import { runtimeKeys, useRuntimeStatus } from "./runtime.api";
import type { CheckoutRef, RuntimeStatus } from "./runtime.types";
import { useCheckoutRef } from "./useCheckoutRef";

const useStyles = makeStyles({
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(26rem, 1fr))", gap: tokens.spacingHorizontalL, alignItems: "start" },
  wide: { gridColumn: "1 / -1" },
});

// `/projects/:key/checkouts/:checkout/runtime`: what ONE checkout needs in order to run, whether this
// machine can run it, what is running and whether it answers. The checkout is the one the ADDRESS
// names, project and checkout both, and every button below acts on that one: choosing another is
// navigation, and no control holds an identity of its own.
export function RuntimePage() {
  const at = useCheckoutRef();
  if (!at) return <MessageBar intent="error"><MessageBarBody>This address does not name a project and a checkout. <RouterLink to={PROJECTS_PATH}>Choose one from Projects.</RouterLink></MessageBarBody></MessageBar>;
  // Keyed by the checkout: choosing another one is a DIFFERENT page, and a draft typed for the first
  // must not be shown on the second -- or saved to it.
  return <Loaded key={`${at.key}/${at.checkout}`} at={at} />;
}

function Loaded({ at }: { at: CheckoutRef }) {
  const client = useQueryClient();
  const status = useRuntimeStatus(at);
  return (
    <>
      <PageHeader
        title="Runtime"
        description="What this checkout needs in order to run, whether this machine can run it, and what is running. Native running needs no container, and nothing here installs a tool."
        context={<CheckoutPicker current={at} />}
        badges={status.data && <StateBadge word={status.data.plan.overall} />}
        actions={<Button icon={<ArrowClockwise20Regular />} disabled={status.isFetching} onClick={() => client.invalidateQueries({ queryKey: runtimeKeys.all(at) })}>Refresh</Button>}
      />
      {status.isPending && <LoadingState label="Reading this checkout's runtime…" />}
      {status.isError && <ErrorState error={status.error} title="Could not read this checkout's runtime" onRetry={() => status.refetch()} />}
      {status.data && <Cards at={at} status={status.data} />}
    </>
  );
}

function Cards({ at, status }: { at: CheckoutRef; status: RuntimeStatus }) {
  const styles = useStyles();
  return (
    <div className={styles.grid}>
      <UnderstandingCard at={at} status={status} />
      <HostCard at={at} status={status} />
      <div className={styles.wide}><ComponentsCard at={at} status={status} /></div>
      <div className={styles.wide}><OsCard status={status} /></div>
      <SessionsCard at={at} status={status} />
      <VerificationCard status={status} />
      <div className={styles.wide}><ConnectivityCard at={at} names={Object.fromEntries(status.plan.components.map((c) => [c.key, c.name]))} /></div>
      <div className={styles.wide}><EnvironmentCard at={at} status={status} /></div>
      <div className={styles.wide}><SettingsCard at={at} settings={status.settings} components={status.plan.components.filter((c) => c.state !== "not-startable").map(({ key, name }) => ({ key, name }))} /></div>
      <div className={styles.wide}><SandboxesCard at={at} /></div>
      <div className={styles.wide}><SandboxPolicyCard at={at} settings={status.settings} /></div>
    </div>
  );
}
