// The schedule DIALECTS a contract may be written in, as a table. Each row is
// { id, doc, parse(expression) → {ok, spec} | {ok: false, error}, next(spec, fromMs, zone, dst?) →
// instantMs | null, candidates(spec, range), needsZone(spec), defaultZone?(spec) }. A dialect
// nobody registered is a GAP, never a guess at what the expression might mean.
import { cron5 } from "./dialects/cron5.mjs";
import { cron6 } from "./dialects/cron6.mjs";
import { iso8601Interval } from "./dialects/iso8601-interval.mjs";

export const DIALECTS = [cron5, cron6, iso8601Interval];

export const dialectOf = (id) => DIALECTS.find((d) => d.id === id) ?? { gap: "dialect", id };
