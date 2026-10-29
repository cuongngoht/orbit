// What a page may see of a PROVIDER: the engine's own view (the fields a connection and a scope ask for, the credential's advice
// and its official pages -- never the token shapes) and, beside it, HOW a connection to that provider can get in: the strategies
// its descriptor declares, in the descriptor's words.
//
// A strategy is shown by an ALLOW-LIST. What a page needs is the choice (id, kind, label, which is preferred), the words around it,
// the options it takes (name, label, type, pattern -- the page renders and checks them from this data and knows no provider) and
// which tool rows hold its session, so it can say where to get one. How a request is authorised and which application a token is
// for are the adapter's: they are never sent.
import { providerDescriptors, publicProviders } from "../core.mjs";

const STRATEGY = ["id", "kind", "label", "preferred", "doc", "docs", "interactive", "sessionOwner", "tools"];
const OPTION = ["name", "label", "type", "pattern", "doc"];

const pick = (from, keys) => Object.fromEntries(keys.filter((k) => from?.[k] !== undefined).map((k) => [k, from[k]]));

const strategyView = (s) => ({ ...pick(s, STRATEGY), ...(Array.isArray(s.options) ? { options: s.options.map((o) => pick(o, OPTION)) } : {}) });

const authenticationOf = (descriptor) => (descriptor?.authentication ? { default: descriptor.authentication.default, strategies: descriptor.authentication.strategies.map(strategyView) } : undefined);

export function providersView() {
  const descriptors = providerDescriptors();
  return publicProviders().map((p) => ({ ...p, authentication: authenticationOf(descriptors.find((d) => d.id === p.id)) }));
}
