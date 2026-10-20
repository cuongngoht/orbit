import { constraintFindings, missingFindings } from "../constraints.mjs";
import { Refused } from "../errors.mjs";

export function checkedId(id, spec) {
  const errors = [...missingFindings(["id"], { id }, "file"), ...constraintFindings({ id: spec }, { id }, "file")];
  if (errors.length) throw new Refused(errors.join("\n"));
  return id;
}
