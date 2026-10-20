import { Field, Select, makeStyles, tokens } from "@fluentui/react-components";
import { useNavigate } from "react-router";
import { checkoutLabel, runtimePath } from "../projects/projectWords";
import { useProjects } from "../projects/projects.api";
import type { CheckoutRef } from "./runtime.types";

const useStyles = makeStyles({
  row: { display: "flex", gap: tokens.spacingHorizontalL, flexWrap: "wrap", alignItems: "end" },
});

// Choosing a project or a checkout is NAVIGATION: it changes the address, and the page reads the
// address. Nothing here is authority for what a button does -- every operation takes both
// identities from the route it was drawn on.
export function CheckoutPicker({ current }: { current: CheckoutRef }) {
  const styles = useStyles();
  const navigate = useNavigate();
  const projects = useProjects().data?.projects ?? [];
  const project = projects.find((p) => p.key === current.key);
  const toProject = (key: string) => {
    const first = projects.find((p) => p.key === key)?.checkouts.find((c) => c.exists) ?? projects.find((p) => p.key === key)?.checkouts[0];
    if (first) navigate(runtimePath(key, first.id));
  };
  return (
    <div className={styles.row}>
      <Field label="Project">
        <Select value={current.key} onChange={(_, d) => toProject(d.value)}>
          {project ? null : <option value={current.key}>{current.key}</option>}
          {projects.map((p) => (
            <option key={p.key} value={p.key}>{p.name}</option>
          ))}
        </Select>
      </Field>
      <Field label="Checkout">
        <Select value={current.checkout} onChange={(_, d) => navigate(runtimePath(current.key, d.value))}>
          {project?.checkouts.some((c) => c.id === current.checkout) ? null : <option value={current.checkout}>{current.checkout.slice(0, 12)}</option>}
          {(project?.checkouts ?? []).map((c) => (
            <option key={c.id} value={c.id}>{checkoutLabel(c)}</option>
          ))}
        </Select>
      </Field>
    </div>
  );
}
