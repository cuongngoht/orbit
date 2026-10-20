import { Spinner } from "@fluentui/react-components";

export function LoadingState({ label = "Loading…" }: { label?: string }) {
  return <Spinner size="small" label={label} labelPosition="after" />;
}
