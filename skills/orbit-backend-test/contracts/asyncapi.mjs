// An AsyncAPI 2.x or 3.0 contract, READ (doc §4.3, §5.4): what an accepted message contract says of ONE channel -- its
// address, who sends and who receives on it, its messages with their payload schema and the correlation they carry --
// as the binding a test pins and the candidate `expects` a person puts in a plan's criterion. It reads and decides
// nothing: a completion window is the accepted criterion's own (`within`, asked of the person, never invented), and a
// value the document does not state (whose business key, which message) is never filled in. A document it does not
// read is SAID: another version, a channel it does not declare, a reference outside the document.
//
//   asyncapiExpects(doc, { channel, within? })
//     -> { ok: true, source, channel: { id, address, actions, messages }, expects, notes } | { ok: false, findings }
import { canonicalJson, sha } from "../../../src/hash.mjs";

const VERSIONS = [{ id: 2, when: (v) => /^2\.\d+\.\d+$/.test(v) }, { id: 3, when: (v) => /^3\.0\.\d+$/.test(v) }];

const READ = [
  { id: "NOT_ASYNCAPI", when: (x) => typeof x.doc?.asyncapi !== "string", say: () => "this is not an AsyncAPI document (it names no `asyncapi` version)" },
  { id: "VERSION", when: (x) => !x.major, say: (x) => `AsyncAPI ${String(x.doc.asyncapi).slice(0, 20)} is not read here — 2.x and 3.0 are` },
  { id: "NO_CHANNEL", when: (x) => !x.channel, say: (x) => `no channel ${String(x.ask.channel ?? "(none named)").slice(0, 80)} — it declares ${channelsOf(x.doc, x.major).map((c) => c.id).join(", ") || "none"}` },
  { id: "REMOTE_REF", when: (x) => x.channel.messages.some((m) => m.remote), say: (x) => `${x.channel.id}: a message is behind a reference outside the document, and nothing here fetches one` },
];

export function asyncapiExpects(doc, ask = {}) {
  const x = facts(doc, ask);
  const stop = READ.find((r) => r.when(x));
  if (stop) return { ok: false, findings: [{ rule: stop.id, say: stop.say(x) }] };
  return { ok: true, source: sourceOf(doc), channel: viewOf(x.channel), ...expectsOf(doc, x) };
}

function facts(doc, ask) {
  const major = typeof doc?.asyncapi === "string" ? VERSIONS.find((v) => v.when(doc.asyncapi))?.id ?? null : null;
  const channel = major ? channelsOf(doc, major).find((c) => c.id === ask.channel || c.address === ask.channel) ?? null : null;
  return { doc, ask, major, channel };
}

// Every channel, in the words both versions share: an id, the address messages travel on, what the application does
// there (send · receive), and its messages. In 2.x a channel is keyed by its address, and `publish` is what OTHERS
// send to the application -- so the application receives -- while `subscribe` is what it sends.
const channelsOf = (doc, major) => (major === 3 ? channels3(doc) : channels2(doc));

const channels3 = (doc) => Object.entries(doc.channels ?? {}).map(([id, c]) => ({ id, address: c.address ?? id, actions: actionsOn3(doc, id), messages: Object.entries(c.messages ?? {}).map(([name, m]) => messageOf(doc, name, m)) }));

const actionsOn3 = (doc, id) => Object.entries(doc.operations ?? {}).filter(([, o]) => o?.channel?.$ref === `#/channels/${id}`).map(([op, o]) => ({ operation: op, action: o.action, summary: o.summary ?? "" }));

const channels2 = (doc) => Object.entries(doc.channels ?? {}).map(([address, c]) => ({ id: address, address, actions: [["publish", "receive"], ["subscribe", "send"]].filter(([k]) => c?.[k]).map(([k, action]) => ({ operation: c[k].operationId ?? k, action, summary: c[k].summary ?? "" })), messages: [c?.publish, c?.subscribe].filter(Boolean).flatMap((o) => (o.message?.oneOf ?? [o.message]).filter(Boolean)).map((m, i) => messageOf(doc, m.name ?? `message-${i + 1}`, m)) }));

function messageOf(doc, name, m) {
  const remote = typeof m?.$ref === "string" && !m.$ref.startsWith("#/");
  const body = remote ? {} : resolved(doc, m);
  return { name: body.name ?? name, remote, contentType: body.contentType ?? doc.defaultContentType ?? null, correlation: resolved(doc, body.correlationId)?.location ?? null, payload: body.payload ? sha(canonicalJson(resolved(doc, body.payload))) : null };
}

const resolved = (doc, v) => (typeof v?.$ref === "string" && v.$ref.startsWith("#/") ? v.$ref.slice(2).split("/").reduce((at, k) => (at && typeof at === "object" ? at[k.replaceAll("~1", "/").replaceAll("~0", "~")] : undefined), doc) ?? {} : v ?? {});

const viewOf = (c) => ({ id: c.id, address: c.address, actions: c.actions, messages: c.messages.map(({ remote, ...m }) => m) });

// What the contract itself states: a correlation each message carries, and -- for a channel the application RECEIVES
// on, with the window the accepted criterion gives -- that a delivery is processed within it.
function expectsOf(doc, x) {
  const where = `${doc.info?.title ?? "AsyncAPI"} ${doc.info?.version ?? ""}`.trim();
  const receives = x.channel.actions.filter((a) => a.action === "receive");
  const correlated = x.channel.messages.filter((m) => m.correlation);
  const window = Number.isInteger(Number(x.ask.within)) && Number(x.ask.within) > 0 ? Number(x.ask.within) : null;
  return { expects: numbered([...correlated.map((m) => ({ property: "message.correlation", op: "present", because: `${where}: ${m.name} on ${x.channel.address} carries its correlation (${m.correlation})` })), ...(receives.length && window ? [{ property: "settlement.outcome", op: "complete-within", value: "processed", within: window, because: `${where}: ${receives.map((a) => a.operation).join(", ")} receives on ${x.channel.address} — ${receives[0].summary}`.slice(0, 300) }] : [])]), notes: receives.length && !window ? ["a completion window is the accepted criterion's own: pass --within=<seconds> from it — none is invented"] : [] };
}

const numbered = (list) => list.map((e, i) => ({ id: `E${i + 1}`, ...e, because: e.because.slice(0, 300) }));

const sourceOf = (doc) => ({ kind: "message-contract", ref: doc.info?.title ?? null, revision: doc.info?.version ?? null, digest: sha(canonicalJson(doc)) });
