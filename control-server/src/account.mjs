// Who is signed in to the host on THIS machine -- the Claude user whose profile
// Claude Code keeps here -- for the page's top bar. Every machine answers with
// its own; nothing is configured or remembered by Control.
//
// Its PROFILE only, through an ALLOW-LIST (`PUBLIC`): a field the host adapter
// gains later cannot reach a page because nobody remembered to leave it out.
// There is no token in this path at all -- the adapter never reads one
// (skills/orbit-learn/hosts/claude-account.mjs) -- and a configuration that
// cannot be read answers "no profile", never an error page. A GET: nothing is
// changed, connected to or started.
const PUBLIC = ["signedIn", "displayName", "email", "organization", "role"];

export function account(ctx) {
  const found = profile(ctx);
  return { host: ctx.world.host.name, ...Object.fromEntries(PUBLIC.filter((k) => found[k] !== undefined).map((k) => [k, found[k]])), signedIn: found.signedIn === true };
}

function profile(ctx) {
  try { return ctx.world.account?.() ?? { signedIn: false }; }
  catch { return { signedIn: false }; }
}
