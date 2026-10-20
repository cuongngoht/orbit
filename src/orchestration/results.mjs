// The three answers an action gives, as one place: it succeeded, it ran and failed, or it could not
// be carried out at all. A result is data the loop settles into the task's journal -- nothing here
// writes, and nothing here decides what a failure is ABOUT (failure.mjs does).
import { RESULT } from "./vocab.mjs";

export const ok = (summary, extra = {}) => ({ outcome: RESULT.SUCCEEDED, summary, ...extra });

export const failed = (summary, extra = {}) => ({ outcome: RESULT.FAILED, summary, ...extra });

export const error = (reason, extra = {}) => ({ outcome: RESULT.ERROR, reason, summary: reason, ...extra });
