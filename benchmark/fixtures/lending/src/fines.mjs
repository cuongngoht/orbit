// FINES for a late return: so much a day, by the title's format, for every day after the day it was due -- and never
// more than it would cost to replace the copy.
import { daysBetween } from "./dates.mjs";

export const DAILY_CENTS = { book: 25, dvd: 100 };

export const daysLate = (due, day) => Math.max(0, daysBetween(due, day));

export const fineFor = (title, copy, due, day) => Math.min(daysLate(due, day) * DAILY_CENTS[title.format], copy.replacementCents);
