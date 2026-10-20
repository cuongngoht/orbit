// Messaging from C#: which client, and which SIDE of the exchange the code is
// on -- producer, consumer, publisher -- only where the code's own types say.
//
// One table, one analyser per client built from its row, because what differs
// between them is data: the package's namespace, the types that mean sending,
// the types that mean receiving. A client whose side the code does not reveal
// is a usage with no role and an unknown saying so -- "this project talks to
// the queue" is a true sentence, and "it consumes" would be a guess.
//
// MassTransit is a framework over a TRANSPORT it does not name in the code that
// uses it, so its usages carry no integration: which broker is behind it is
// configured elsewhere, and saying otherwise would be inventing it.
import { code, defines, found, hasNamespace, matching } from "./csharp.mjs";

const CLIENTS = [
  { id: "servicebus", technology: "azure-service-bus", integration: "service-bus", namespace: "Azure.Messaging.ServiceBus", triggers: ["Azure.Messaging.ServiceBus", "ServiceBusClient"], roles: [{ re: /\bServiceBusSender\b|\.SendMessages?Async\b/, role: "producer" }, { re: /\bServiceBus(?:Session)?Processor\b|\bServiceBusReceiver\b/, role: "consumer" }] },
  { id: "kafka", technology: "kafka", integration: "kafka", namespace: "Confluent.Kafka", triggers: ["Confluent.Kafka"], roles: [{ re: /\bProducerBuilder\b|\bIProducer\s*</, role: "producer" }, { re: /\bConsumerBuilder\b|\bIConsumer\s*</, role: "consumer" }] },
  { id: "rabbitmq", technology: "rabbitmq", integration: "rabbitmq", namespace: "RabbitMQ.Client", triggers: ["RabbitMQ.Client"], roles: [{ re: /\.BasicPublish(?:Async)?\b/, role: "publisher" }, { re: /\.BasicConsume(?:Async)?\b|\b(?:Async)?EventingBasicConsumer\b/, role: "consumer" }] },
  { id: "masstransit", technology: "masstransit", namespace: "MassTransit", triggers: ["MassTransit"], unknowns: ["which transport carries these messages — MassTransit is configured over a broker the code that uses it does not name"], roles: [{ re: /\bIPublishEndpoint\b|\.Publish\s*[<(]/, role: "publisher" }, { re: /\bISendEndpoint(?:Provider)?\b/, role: "producer" }, { re: /[:,]\s*IConsumer\s*</, role: "consumer" }] },
];

const NO_ROLE = "which side of the exchange this code is on — it names the client, not whether it sends or receives";

const analyzerOf = (row) => ({
  id: `dotnet.${row.id}`,
  ecosystem: "dotnet",
  doc: `${row.technology} usage, and whether the code produces, publishes or consumes`,
  requires: [row.technology],
  extensions: [".cs"],
  triggers: row.triggers,
  operations: ["messages"],
  analyze: ({ text }) => usageOf(row, code(text)),
});

function usageOf(row, c) {
  if (!hasNamespace(c, row.namespace)) return { usages: [], defines: defines(c) };
  const base = { technology: row.technology, ...(row.integration ? { integration: row.integration } : {}), operation: "messages", confidence: "certain", signals: [row.namespace] };
  const roles = matching(c, row.roles);
  return { defines: defines(c), usages: roles.length ? roles.map((r) => ({ ...base, role: r.role, signals: [...base.signals, ...found(c, r.re)], ...extra(row.unknowns) })) : [{ ...base, ...extra([...(row.unknowns ?? []), NO_ROLE]) }] };
}

const extra = (unknowns) => (unknowns?.length ? { unknowns } : {});

export const messaging = CLIENTS.map(analyzerOf);
