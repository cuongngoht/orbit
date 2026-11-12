#!/usr/bin/env node
// THE EGRESS PROXY of one run, in a container of its own: the only way out of the run's internal network. It allows
// HTTPS CONNECT to the hosts it is started with, on port 443, and refuses every other CONNECT and every plain request.
// TLS is end to end, so it sees a host, a port and a byte count, and it prints one JSON line per request. Copied into
// its container alone; it imports nothing but Node.
//
//   node egress.mjs <port> <host>[,<host>...]
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
  const upstream = connect(t.port, t.host, () => {
    socket.write("HTTP/1.1 200 Connection Established\r\n\r\n", () => {
      upstream.write(head);
      upstream.pipe(socket);
      socket.pipe(upstream);
    });
  });
  upstream.on("error", () => socket.end("HTTP/1.1 502 Bad Gateway\r\n\r\n"));
  socket.on("error", () => upstream.destroy());
  socket.on("close", () => logged({ host: t.host, port: t.port, allowed: true, bytesIn: upstream.bytesRead, bytesOut: upstream.bytesWritten }));
}

function refused(req, socket) {
  logged({ target: String(req.url).slice(0, 260), allowed: false });
  socket.end("HTTP/1.1 403 Forbidden\r\n\r\n");
}

function main(port, hostList) {
  const hosts = String(hostList ?? "").split(",").map((h) => h.trim().toLowerCase()).filter(Boolean);
  const server = createServer((req, res) => (logged({ plain: true, allowed: false }), res.writeHead(403).end()));
  server.on("connect", (req, socket, head) => ((t) => (t.ok ? tunnel(socket, head, t) : refused(req, socket)))(allowedTarget(req.url, hosts)));
  server.listen(Number(port), "0.0.0.0", () => logged({ listening: Number(port), hosts }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv[2], process.argv[3]);
