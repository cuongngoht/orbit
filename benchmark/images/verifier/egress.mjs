#!/usr/bin/env node
// THE EGRESS PROXY of a benchmark run: the one way out of the run's internal network. A runner reaches the model's API
// through it with HTTPS CONNECT, and only the hosts it was started with, on port 443, get through; every other CONNECT
// and every plain request is refused. It sees only a host, a port and how many bytes passed -- TLS is end to end, so
// no request or answer is ever readable here -- and it prints one line per CONNECT to its own log, nothing else.
//
//   node egress.mjs <port> <host>[,<host>…]
//   allowedTarget(target, hosts) -> { ok, host, port }
import { createServer } from "node:http";
import { connect } from "node:net";
import { pathToFileURL } from "node:url";

const TARGET = /^([A-Za-z0-9.-]{1,253}):(\d{1,5})$/;

export function allowedTarget(target, hosts) {
  const m = TARGET.exec(String(target ?? ""));
  const host = m ? m[1].toLowerCase().replace(/\.$/, "") : null;
  return { ok: Boolean(m) && m[2] === "443" && hosts.includes(host), host, port: m ? Number(m[2]) : null };
}

const logged = (what) => process.stdout.write(`${JSON.stringify({ at: new Date().toISOString(), ...what })}\n`);

function tunnel(socket, head, t) {
  const upstream = connect(t.port, t.host, () => socket.write("HTTP/1.1 200 Connection Established\r\n\r\n", () => (upstream.write(head), upstream.pipe(socket), socket.pipe(upstream))));
  upstream.on("error", () => socket.end("HTTP/1.1 502 Bad Gateway\r\n\r\n"));
  socket.on("error", () => upstream.destroy());
  socket.on("close", () => logged({ host: t.host, port: t.port, allowed: true, bytesIn: upstream.bytesRead, bytesOut: upstream.bytesWritten }));
}

const onConnect = (hosts) => (req, socket, head) => ((t) => (t.ok ? tunnel(socket, head, t) : (logged({ target: String(req.url).slice(0, 260), allowed: false }), socket.end("HTTP/1.1 403 Forbidden\r\n\r\n"))))(allowedTarget(req.url, hosts));

const refusedPlain = (req, res) => (logged({ plain: true, allowed: false }), res.writeHead(403).end());

function main(port, hosts) {
  const allowed = String(hosts ?? "").split(",").map((h) => h.trim().toLowerCase()).filter(Boolean);
  createServer(refusedPlain).on("connect", onConnect(allowed)).listen(Number(port), "0.0.0.0", () => logged({ listening: Number(port), hosts: allowed }));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main(process.argv[2], process.argv[3]);
