// The connectivity TARGETS a person set for this machine, as the rest of the subject reads them.
//
// Pure: settings in, targets out. A target is a host and a port a person named, which components
// require it, where to ask from, whether a start waits on it, and the retry policy that applies to
// it -- its own, laid over the block's. Nothing here asks the network: that is check.mjs, through a
// provider, and only ever with a target read from here.
import { canonicalJson, short } from "../../hash.mjs";

// What an observation is ABOUT: where a target points, never what it is called. A new label keeps
// what was observed; a moved host, port or protocol is a different question, and the old answer
// stops being one.
export const targetPrint = (t) => short(canonicalJson({ host: t.host, port: t.port, protocol: t.protocol }), 12);

// -> [{ id, label, host, port, protocol, requiredBy, checkFrom, beforeStart, note?, retry, print }], by id.
export const targetsOf = (settings) =>
  Object.entries(settings.connectivity?.targets ?? {})
    .map(([id, t]) => ({ id, ...t, retry: { ...settings.connectivity.retry, ...(t.retry ?? {}) }, print: targetPrint(t) }))
    .sort((a, b) => a.id.localeCompare(b.id));

export const targetNamed = (targets, id) => targets.find((t) => t.id === id) ?? null;

// The targets a start of ONE component must find reachable first, from where it will run.
export const gatesOf = (targets, key, provider) => targets.filter((t) => t.beforeStart && t.requiredBy.includes(key) && t.checkFrom.includes(provider));

// How a sentence names a target: what a person called it, and where it points.
export const whereOf = (t) => `${t.label} (${t.host}:${t.port})`;

// A host that is already an ADDRESS (IPv4 dotted, or IPv6 -- the one shape a name never has, since
// settings refuse a colon in one) rather than a name to look up.
export const isAddress = (host) => /^\d{1,3}(\.\d{1,3}){3}$/.test(String(host)) || String(host).includes(":");
