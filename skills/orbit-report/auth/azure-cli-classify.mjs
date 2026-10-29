// What a FINISHED command says about the sign-in, from one ordered table over what it printed: the first row that
// matches decides, and the last always does. The markers are the tool's own stable words -- a fixed sentence it prints
// when no one has signed in, and the numeric codes its sign-in service documents for "a person must do something".
// Nothing here looks at a message to GUESS: an answer it does not recognise is `failed`, and says what it said
// (bounded and scrubbed, by the caller), never `login-required`.
//
// The not-signed-in sentence is real: it is what the tool prints, with exit 1, from an empty profile (captured from
// the releases Orbit pins and from the older one a machine may have). The codes are documented ones.
const INTERACTION_CODES = [50076, 50078, 50079, 50089, 50158, 50173, 65001, 70008, 70043, 700082];

const textOf = (r) => `${r?.err ?? ""}\n${r?.out ?? ""}\n${r?.error ?? ""}`;

const hasCode = (text) => INTERACTION_CODES.some((code) => text.includes(`AADSTS${code}`));

const UNREACHABLE = /ConnectionError|Max retries exceeded|Failed to establish a new connection|getaddrinfo|Name or service not known|SSLError|ProxyError|timed out|Temporary failure in name resolution/i;

export const OUTCOMES = [
  { when: (r) => r?.ok === true, is: "ok" },
  { when: (r) => r?.timedOut === true, is: "network" },
  { when: (r) => r?.unstarted === true, is: "failed" },
  { when: (r) => /Please run 'az login'|no subscription.*az login/i.test(textOf(r)), is: "login-required" },
  { when: (r) => /Interactive authentication is needed|interaction_required/i.test(textOf(r)) || hasCode(textOf(r)), is: "interaction-required" },
  { when: (r) => UNREACHABLE.test(textOf(r)), is: "network" },
  { when: () => true, is: "failed" },
];

export const classify = (result) => OUTCOMES.find((row) => row.when(result)).is;

// A logout that finds nobody signed in has nothing to do, and is not a failure.
export const alreadyOut = (result) => result?.ok === true || /no active accounts|Please run 'az login'/i.test(textOf(result));

// A person closing the window or declining is a choice, not a fault.
export const cancelled = (result) => result?.timedOut === true || /cancel|AADSTS65004|User declined/i.test(textOf(result));
