// Six-field cron: a leading SECOND, then the five fields of cron5, matched the same way. A macro
// fires at second 0.
import { withNext } from "../series.mjs";
import { FIELD, cronWalls, parseCron } from "./cron.mjs";

const FIELDS = [FIELD.second, FIELD.minute, FIELD.hour, FIELD.dayOfMonth, FIELD.month, FIELD.dayOfWeek];

export const cron6 = withNext({
  id: "cron6",
  doc: "six-field cron (second minute hour day-of-month month day-of-week) and the @-macros at second 0; Vixie day matching on the contract zone's wall time",
  needsZone: () => true,
  parse: (expression) => parseCron(expression, FIELDS, "0 "),
  candidates: (spec, range) => cronWalls(spec, range),
});
