// Explicit unknown is not the absence of a failure.
export const outcomeOf = (event) => event.outcome ?? (event.ok === null ? "unknown" : event.ok === false ? "failure" : "success");
export const okOf = (event) => ({ success: true, failure: false, unknown: null })[outcomeOf(event)] ?? null;
