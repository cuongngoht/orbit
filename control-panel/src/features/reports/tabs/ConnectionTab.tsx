import { useState } from "react";
import { Button, Caption1, Dropdown, Field, Link, Option, Text } from "@fluentui/react-components";
import { PlugConnected20Regular } from "@fluentui/react-icons";
import { mutationToken } from "../../../shared/api/client";
import { Card } from "../../../shared/components/Card";
import { ErrorState } from "../../../shared/components/ErrorState";
import { LoadingState } from "../../../shared/components/LoadingState";
import { useFollow } from "../../../shared/navigation/useFollow";
import { connectionsApi, useConnectionChange } from "../../connections/connections.api";
import { CONNECTIONS_PATH, connectionPath, credentialWords, newerTest } from "../../connections/connectionWords";
import { useReportSettings } from "../reports.api";
import type { SettingsView } from "../reports.types";
import { isAvailable, reportTabPath } from "../reportWords";
import { NotHere } from "./OverviewTab";
import { SaveBar, useFormStyles, useSaveSettings } from "./SettingsTab";
import { Checks } from "../../connections/ConnectionChecks";

export function ConnectionTab() {
  const view = useReportSettings();
  if (view.isPending) return <LoadingState label="Loading…" />;
  if (view.isError) return <ErrorState error={view.error} title="Could not read the report settings" onRetry={() => view.refetch()} />;
  if (!isAvailable(view.data)) return <NotHere why={view.data.why} />;
  return <Chooser key={view.data.revision ?? "new"} view={view.data} />;
}

// The report reads through exactly the connection chosen here -- never one it
// guessed, and never a token found lying around on the machine.
function Chooser({ view }: { view: SettingsView }) {
  const styles = useFormStyles();
  const follow = useFollow();
  const [chosen, setChosen] = useState(view.settings.connection ?? "");
  const save = useSaveSettings(view);
  const test = useConnectionChange((id: string) => connectionsApi.test(id));
  const usable = view.connections.filter((c) => !view.settings.provider || c.provider === view.settings.provider);
  const current = view.connections.find((c) => c.id === chosen);
  const shown = current && newerTest(test.data, current.lastTest);
  if (!view.settings.provider) return <Card title="Connection"><Text>Choose the report's source first, on <Link href={reportTabPath("settings")} onClick={follow(reportTabPath("settings"))}>Settings</Link>.</Text></Card>;
  return (
    <div className={styles.stack}>
      <Card title="Connection" subtitle="Which account's access this project's report reads through." action={<Link href={CONNECTIONS_PATH} onClick={follow(CONNECTIONS_PATH)}>Manage connections</Link>}>
        {usable.length ? (
          <Field label="Connection">
            <Dropdown value={current?.label || current?.id || ""} selectedOptions={chosen ? [chosen] : []} onOptionSelect={(_, d) => setChosen(d.optionValue ?? "")}>
              {usable.map((c) => (
                <Option key={c.id} value={c.id}>
                  {c.label || c.id}
                </Option>
              ))}
            </Dropdown>
          </Field>
        ) : (
          <Text>No {view.settings.provider} connection on this machine yet. <Link href={CONNECTIONS_PATH} onClick={follow(CONNECTIONS_PATH)}>Create one</Link>.</Text>
        )}
        {current && (
          <Caption1>
            {current.organization} · {current.host} · {credentialWords(current.credential)} · <Link href={connectionPath(current.id)} onClick={follow(connectionPath(current.id))}>Open</Link>
          </Caption1>
        )}
      </Card>
      <SaveBar save={save} onSave={() => save.mutate({ ...view.settings, connection: chosen || null })} />
      {current && (
        <Card title="Test for this project" subtitle="Authentication, then each read this project's scope asks for." action={<Button icon={<PlugConnected20Regular />} disabled={!mutationToken() || test.isPending} onClick={() => test.mutate(current.id)}>{test.isPending ? "Testing…" : "Test"}</Button>}>
          {test.isError && <ErrorState error={test.error} title="The test did not finish" />}
          {shown ? <Checks test={shown} /> : <Caption1>Not tested yet.</Caption1>}
        </Card>
      )}
    </div>
  );
}
