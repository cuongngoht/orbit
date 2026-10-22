// This application's own minimal NATS client (core protocol, headers on): CONNECT with a user
// and password, PUB/HPUB, SUB/UNSUB, MSG/HMSG, PING/PONG, and request/reply over one inbox
// subscription. It is deliberately not the client anything that TESTS this application uses.
//
// connect(o) -> { publish, request, subscribe, unsubscribe, flush, close, ended }
// A message is { subject, sid, reply, headers, status, description, data: Buffer }.
import { randomBytes } from "node:crypto";
import { createConnection } from "node:net";

const CRLF = "\r\n";
const HEADER_LINE = "NATS/1.0";

function encodeHeaders(headers) {
  const lines = Object.entries(headers).map(([k, v]) => {
    if (/[\r\n:]/.test(k) || /[\r\n]/.test(String(v))) throw new Error(`a header cannot hold a line break: ${k}`);
    return `${k}: ${v}`;
  });
  return Buffer.from(`${HEADER_LINE}${CRLF}${lines.map((l) => `${l}${CRLF}`).join("")}${CRLF}`);
}

function decodeHeaders(buf) {
  const lines = buf.toString("utf8").split(CRLF);
  const first = /^NATS\/1\.0(?:\s+(\d{3})(?:\s+(.*))?)?$/.exec(lines[0].trim()) ?? [];
  const headers = {};
  for (const line of lines.slice(1)) {
    const at = line.indexOf(":");
    if (at > 0) headers[line.slice(0, at).trim()] = line.slice(at + 1).trim();
  }
  return { headers, status: first[1] ? Number(first[1]) : null, description: first[2] ?? "" };
}

const asBuffer = (data) => (Buffer.isBuffer(data) ? data : data === undefined || data === null ? Buffer.alloc(0) : Buffer.from(typeof data === "string" ? data : JSON.stringify(data)));

export function connect({ host = "127.0.0.1", port = 4222, user, password, name = "invoice", timeoutMs = 10000 } = {}) {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host, port });
    const inbox = `_INBOX.${randomBytes(10).toString("hex")}`;
    const st = { buf: Buffer.alloc(0), info: null, open: false, closing: false, sids: new Map(), next: 2, tokens: 0, waiting: new Map(), pongs: [] };
    let endWith;
    const ended = new Promise((r) => { endWith = r; });
    const timer = setTimeout(() => socket.destroy(new Error(`no NATS handshake within ${timeoutMs} ms`)), timeoutMs);

    const write = (chunk) => socket.write(chunk);

    function end(why) {
      if (st.ended) return;
      st.ended = true;
      clearTimeout(timer);
      for (const w of st.waiting.values()) w.reject(new Error(why));
      st.waiting.clear();
      for (const p of st.pongs.splice(0)) p.reject(new Error(why));
      if (!st.open) return reject(new Error(why));
      return endWith(st.closing ? null : why);
    }

    function deliver(m) {
      if (m.sid === "1") {
        const token = m.subject.slice(inbox.length + 1);
        const w = st.waiting.get(token);
        if (!w) return;
        st.waiting.delete(token);
        clearTimeout(w.timer);
        return w.resolve(m);
      }
      const sub = st.sids.get(m.sid);
      if (sub) Promise.resolve().then(() => sub(m)).catch(() => {});
    }

    function control(line) {
      if (line.startsWith("INFO ")) {
        if (st.info) return;
        st.info = JSON.parse(line.slice(5));
        write(`CONNECT ${JSON.stringify({ verbose: false, pedantic: false, tls_required: false, name, lang: "node", version: "1", protocol: 1, headers: true, no_responders: true, ...(user ? { user, pass: password ?? "" } : {}) })}${CRLF}`);
        write(`SUB ${inbox}.* 1${CRLF}PING${CRLF}`);
        return;
      }
      if (line === "PING") return void write(`PONG${CRLF}`);
      if (line === "PONG") {
        if (!st.open) {
          st.open = true;
          clearTimeout(timer);
          return resolve(api);
        }
        return st.pongs.shift()?.resolve();
      }
      if (line.startsWith("-ERR")) {
        const why = line.slice(4).trim().replace(/^'|'$/g, "");
        if (!st.open || /authorization|authentication|parser|stale|maximum/i.test(why)) socket.destroy(new Error(why));
      }
    }

    // MSG <subject> <sid> [reply] <#bytes>  ·  HMSG <subject> <sid> [reply] <#hdr> <#total>
    function parse() {
      for (;;) {
        const eol = st.buf.indexOf(CRLF);
        if (eol < 0) return;
        const line = st.buf.toString("utf8", 0, eol);
        const parts = line.split(" ").filter(Boolean);
        if (parts[0] === "MSG" || parts[0] === "HMSG") {
          const withHeaders = parts[0] === "HMSG";
          const total = Number(parts.at(-1));
          const headerBytes = withHeaders ? Number(parts.at(-2)) : 0;
          const reply = parts.length === (withHeaders ? 6 : 5) ? parts[3] : null;
          if (st.buf.length < eol + 2 + total + 2) return;
          const body = st.buf.subarray(eol + 2, eol + 2 + total);
          st.buf = st.buf.subarray(eol + 2 + total + 2);
          const head = withHeaders ? decodeHeaders(body.subarray(0, headerBytes)) : { headers: null, status: null, description: "" };
          deliver({ subject: parts[1], sid: parts[2], reply, ...head, data: Buffer.from(body.subarray(headerBytes)) });
          continue;
        }
        st.buf = st.buf.subarray(eol + 2);
        control(line);
      }
    }

    socket.on("data", (chunk) => {
      st.buf = st.buf.length ? Buffer.concat([st.buf, chunk]) : chunk;
      try { parse(); } catch (e) { socket.destroy(e); }
    });
    socket.on("error", (e) => end(e.message));
    socket.on("close", () => end("the connection to NATS closed"));

    function publish(subject, data, { headers, reply } = {}) {
      const body = asBuffer(data);
      const to = reply ? ` ${reply}` : "";
      if (!headers || !Object.keys(headers).length) return write(Buffer.concat([Buffer.from(`PUB ${subject}${to} ${body.length}${CRLF}`), body, Buffer.from(CRLF)]));
      const head = encodeHeaders(headers);
      return write(Buffer.concat([Buffer.from(`HPUB ${subject}${to} ${head.length} ${head.length + body.length}${CRLF}`), head, body, Buffer.from(CRLF)]));
    }

    function request(subject, data, { headers, timeoutMs: within = 5000 } = {}) {
      if (st.ended) return Promise.reject(new Error("the connection to NATS is closed"));
      const token = String((st.tokens += 1));
      return new Promise((res, rej) => {
        const t = setTimeout(() => {
          st.waiting.delete(token);
          rej(new Error(`no reply to ${subject} within ${within} ms`));
        }, within);
        st.waiting.set(token, { resolve: res, reject: rej, timer: t });
        publish(subject, data, { headers, reply: `${inbox}.${token}` });
      });
    }

    const api = {
      inbox,
      publish,
      request,
      subscribe(subject, onMessage) {
        const sid = String((st.next += 1));
        st.sids.set(sid, onMessage);
        write(`SUB ${subject} ${sid}${CRLF}`);
        return sid;
      },
      unsubscribe(sid) {
        st.sids.delete(sid);
        if (!st.ended) write(`UNSUB ${sid}${CRLF}`);
      },
      flush: () => new Promise((res, rej) => {
        st.pongs.push({ resolve: res, reject: rej });
        write(`PING${CRLF}`);
      }),
      close() {
        st.closing = true;
        socket.end();
      },
      ended,
    };
  });
}
