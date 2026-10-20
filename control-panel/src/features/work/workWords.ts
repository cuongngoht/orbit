import type { EvidenceLevel, LifecycleTone, WorkRef } from "./work.types";

// The words a tracked work is shown in. The lifecycle's word, glyph, tone and sentence are the ENGINE's
// (src/work/track/vocab.mjs LIFECYCLE) and arrive with the view; this names the evidence levels, the path of the
// page and how a check ended. Every status carries its WORD -- a colour is never the only signal -- and
// nothing here says "passed": a command that ended well "ended ok", and a check is a command NAMED like one.

export const WORK_PATH = "/work";

/** The route below Work that names one work: both identities of its checkout, and its own. */
export const WORK_ROUTE = ":key/checkouts/:checkout/works/:work";

const part = encodeURIComponent;

export const workPath = (ref: WorkRef) => `${WORK_PATH}/${part(ref.key)}/checkouts/${part(ref.checkout)}/works/${part(ref.work)}`;

export const worksApiPath = (key: string, checkout: string) => `/api/v1/projects/${part(key)}/checkouts/${part(checkout)}/works`;

export const workApiPath = (ref: WorkRef) => `${worksApiPath(ref.key, ref.checkout)}/${part(ref.work)}`;

export type Tone = "brand" | "success" | "warning" | "danger" | "informative" | "subtle";

export const TONE: Record<LifecycleTone, Tone> = { danger: "danger", success: "success", warning: "warning", subtle: "subtle" };

export const EVIDENCE: Record<EvidenceLevel, { tone: Tone; word: string }> = {
  none: { tone: "subtle", word: "no evidence" },
  observed: { tone: "informative", word: "observed" },
  reported: { tone: "warning", word: "reported" },
  verified: { tone: "success", word: "verified" },
};

export const RESULT_WORDS = { "exit-ok": "ended ok", "exit-error": "ended with an error", unknown: "result not reported", running: "running" } as const;

export const LIVENESS_WORDS = { ACTIVE: "a session is moving", QUIET: "its session is quiet", ENDED: "its session ended", NONE: "no session activity" } as const;
