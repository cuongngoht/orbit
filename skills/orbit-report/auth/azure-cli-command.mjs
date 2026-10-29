// What the Azure CLI is ASKED, as argument lists and nothing else: no shell, no string a person typed, no token (a
// token is only ever the answer, never the question), and never `--debug` or `--verbose`, which would print what a
// request carried. The caller puts these after the launcher's own leading arguments (src/tools/launch.mjs).
//
// `resource` is the application the token is for: it comes from the provider's descriptor, not from here.

// A short-lived access token for the source, as JSON. `--only-show-errors` keeps warnings out of the answer; it is NOT
// used for a sign-in, whose prompts (the browser notice, the device code) are warnings a person has to see.
export const tokenArgs = ({ resource, tenant }) => ["account", "get-access-token", "--resource", resource, "--output", "json", "--only-show-errors", ...(tenant ? ["--tenant", tenant] : [])];

// Sign in once. `--allow-no-subscriptions`: a person who only has the source (no cloud subscription) must still be
// able to. `--output none`: what the CLI would print about subscriptions is not kept or shown.
export const loginArgs = ({ resource, tenant, deviceCode }) => ["login", "--scope", `${resource}/.default`, "--allow-no-subscriptions", "--output", "none", ...(tenant ? ["--tenant", tenant] : []), ...(deviceCode ? ["--use-device-code"] : [])];

export const logoutArgs = () => ["logout"];

// Which directories this sign-in reaches -- asked only on the way to an error, to say which one to name.
export const tenantsArgs = () => ["account", "list", "--query", "[].tenantId", "--output", "json", "--only-show-errors"];
