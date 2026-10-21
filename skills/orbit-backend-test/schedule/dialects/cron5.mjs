// Five-field cron -- minute hour day-of-month month day-of-week -- and the @-macros, matched on the
// contract zone's wall time. Day matching and every other choice are cron.mjs's, stated there.
import { withNext } from "../series.mjs";
import { FIELD, cronWalls, parseCron } from "./cron.mjs";

const FIELDS = [FIELD.minute, FIELD.hour, FIELD.dayOfMonth, FIELD.month, FIELD.dayOfWeek];

export const cron5 = withNext({
  id: "cron5",
  doc: "five-field cron (minute hour day-of-month month day-of-week) and @yearly, @monthly, @weekly, @daily, @hourly; Vixie day matching on the contract zone's wall time",
  needsZone: () => true,
  parse: (expression) => parseCron(expression, FIELDS),
  candidates: (spec, range) => cronWalls(spec, range),
});
