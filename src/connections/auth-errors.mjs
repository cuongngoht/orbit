// How a connection's AUTHENTICATION stops a run, as BLOCKED (exit 3): the product is not wrong, we could not get in.
//
// Every refusal here is made of fixed words and a CODE. What a sign-in tool printed -- the text of an error, a line a
// person was meant to read once -- is never put into a message as it came: it passes `excerpt`, which masks every
// token this process issued, scrubs what looks like a secret, strips what a terminal would obey and cuts it short.
// `next` is the one thing a person does about it, when there is one.
import { Blocked } from "../errors.mjs";
import { printable } from "../printable.mjs";
import { maskValues, scrub } from "../scrub.mjs";

// The names are neutral on purpose: which tool or service is behind a code is the provider's descriptor to say.
export const AUTH_CODES = ["AUTH_TOOL_MISSING", "AUTH_TOOL_UNSUPPORTED", "AUTH_TOOL_UNVERIFIED", "AUTH_LOGIN_REQUIRED", "AUTH_LOGIN_CANCELLED", "AUTH_LOGIN_FAILED", "AUTH_TOKEN_FAILED", "AUTH_TENANT_AMBIGUOUS", "AUTH_REJECTED", "AUTH_FORBIDDEN", "AUTH_CREDENTIAL_MISSING", "AUTH_PROFILE_LOCATION"];

export class AuthBlocked extends Blocked {
  constructor(code, message, next = null) {
    super(message);
    this.code = code;
    this.next = next;
  }
}

// What a tool said, made safe to show: tokens masked, secrets scrubbed, control characters gone, one line, short.
export const excerpt = (text, secrets = [], most = 240) => scrub(maskValues(printable(String(text ?? "")), secrets)).replace(/\s+/g, " ").trim().slice(0, most);
