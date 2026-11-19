// Token mode: this Orbit Web answers a host name beyond loopback, so it asks for its access token first.
import { Button, Card, Field, Input, MessageBar, MessageBarBody, Title3, makeStyles } from "@fluentui/react-components";
import { useState } from "react";
import { errorText, send } from "../services/api";

const useStyles = makeStyles({ page: { maxWidth: "420px", margin: "80px auto", padding: "0 16px" }, form: { display: "flex", flexDirection: "column", gap: "12px" } });

export function AccessPage({ onGranted }: { onGranted: () => void }) {
  const s = useStyles();
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <div className={s.page}>
      <Card>
        <form
          className={s.form}
          onSubmit={(e) => {
            e.preventDefault();
            send("POST", "/api/access", { token }).then(onGranted, (err: unknown) => setError(errorText(err)));
          }}
        >
          <Title3>Orbit Web</Title3>
          <Field label="Access token">
            <Input type="password" value={token} onChange={(_, d) => setToken(d.value)} autoComplete="current-password" />
          </Field>
          {error && (
            <MessageBar intent="error">
              <MessageBarBody>{error}</MessageBarBody>
            </MessageBar>
          )}
          <Button appearance="primary" type="submit" disabled={token.length === 0}>
            Continue
          </Button>
        </form>
      </Card>
    </div>
  );
}
