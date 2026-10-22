// The real systems a conformance kit runs an adapter against (doc §5.10): each a row naming the
// image it starts, the port it serves, how to learn it is ready and how a WITNESS -- the system's
// own tooling, never the adapter under test -- reads what it holds. Started on loopback, with a
// password made for the run, and removed when the kit ends whatever happened.
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";

const docker = (args, opts = {}) => spawnSync("docker", args, { encoding: "utf8", timeout: opts.timeoutMs ?? 120_000 });
const logsOf = (name) => { const r = docker(["logs", name]); return `${r.stdout}${r.stderr}`; };

export const BROKERS = {
  "amqp-0-9-1": {
    image: "rabbitmq:4",
    port: 5672,
    user: "orbit-kit",
    env: (secret) => ({ RABBITMQ_DEFAULT_USER: "orbit-kit", RABBITMQ_DEFAULT_PASS: secret, RABBITMQ_DEFAULT_VHOST: "/kit" }),
    command: () => [],
    endpoint: (host, port) => ({ host, port, vhost: "/kit" }),
    // The server's own word that it finished starting. A CLI exec before then can race the server
    // for its Erlang cookie and take the node down, so the witness is asked only after this.
    ready: (name) => /Server startup complete/.test(logsOf(name)),
    // How many messages a queue holds, by the broker's own CLI.
    pending: (name, r) => JSON.parse(docker(["exec", name, "rabbitmqctl", "list_queues", "-p", "/kit", "name", "messages", "--formatter", "json", "-q"]).stdout || "[]").find((q) => q.name === r.queue)?.messages ?? null,
  },
  "nats-jetstream": {
    image: "nats:2-alpine",
    port: 4222,
    user: "orbit-kit",
    env: () => ({}),
    command: (secret) => ["-js", "-m", "8222", "--user", "orbit-kit", "--pass", secret],
    endpoint: (host, port) => ({ host, port }),
    ready: (name) => /Server is ready/.test(logsOf(name)),
    // How many messages a consumer has not yet been handed, by the server's own monitoring endpoint.
    pending: (name, r) => consumerPending(JSON.parse(docker(["exec", name, "wget", "-qO-", "http://127.0.0.1:8222/jsz?consumers=true&accounts=true"]).stdout || "{}"), r),
  },
};

function consumerPending(jsz, r) {
  const streams = (jsz.account_details ?? []).flatMap((a) => a.stream_detail ?? []);
  const consumer = streams.find((s) => s.name === r.stream)?.consumer_detail?.find((c) => c.name === r.consumer);
  return consumer ? (consumer.num_pending ?? 0) + (consumer.num_ack_pending ?? 0) : null;
}

export function started(transport) {
  const row = BROKERS[transport];
  if (!row) throw new Error(`no system recipe for ${transport}`);
  const secret = randomBytes(18).toString("hex");
  const name = `orbit-kit-${transport.replace(/[^a-z0-9]/g, "")}-${randomBytes(4).toString("hex")}`;
  const envArgs = Object.entries(row.env(secret)).flatMap(([k, v]) => ["-e", `${k}=${v}`]);
  const run = docker(["run", "-d", "--rm", "--name", name, "--label", "orbit.kit=messaging", ...envArgs, "-p", `127.0.0.1::${row.port}`, row.image, ...row.command(secret)]);
  if (run.status !== 0) throw new Error(`docker run ${row.image} failed: ${run.stderr.trim()}`);
  const port = Number(docker(["port", name, String(row.port)]).stdout.trim().split("\n")[0].split(":").pop());
  return { name, row, secret, endpoint: row.endpoint("127.0.0.1", port), image: imageDigest(row.image) };
}

export async function readyWithin(broker, ms) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (broker.row.ready(broker.name)) return true;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

export const witnessOf = (broker) => ({ pending: (r) => broker.row.pending(broker.name, r) });

export const removed = (broker) => docker(["rm", "-f", broker.name]).status === 0;

const imageDigest = (image) => docker(["image", "inspect", image, "--format", "{{index .RepoDigests 0}}"]).stdout.trim() || image;
