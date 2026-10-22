// A zero-dependency PostgreSQL client: the startup handshake (trust, cleartext, MD5 or
// SCRAM-SHA-256), then the SIMPLE query protocol only. Every value reaches SQL through `lit()` --
// the `sql` tag applies it to each interpolation -- so a query is one string the server parses
// once, and nothing a caller typed is ever spliced in raw.
//
// One connection per process, used by one operation at a time: `query` and `tx` queue behind each
// other, so a transaction holds the connection until it commits or rolls back. A connection that
// dies is replaced on the next call; nothing is retried behind a caller's back.
import { createHash, createHmac, pbkdf2Sync, randomBytes, timingSafeEqual } from "node:crypto";
import { createConnection } from "node:net";

const PROTOCOL = 196608;
const RAW = Symbol("raw");

export class PgError extends Error {
  constructor(fields) {
    super(fields.M ?? "postgres error");
    this.name = "PgError";
    this.code = fields.C ?? null;
    this.detail = fields.D ?? null;
    this.constraint = fields.n ?? null;
    this.severity = fields.S ?? null;
  }
}

// ---- values into SQL --------------------------------------------------------------------------

export const raw = (text) => ({ [RAW]: String(text) });

export function lit(v) {
  if (v === null || v === undefined) return "NULL";
  if (v && typeof v === "object" && RAW in v) return v[RAW];
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if (typeof v === "number" || typeof v === "bigint") return numberLit(v);
  if (typeof v === "object") return `${textLit(JSON.stringify(v))}::jsonb`;
  return textLit(String(v));
}

function numberLit(v) {
  if (typeof v === "number" && !Number.isFinite(v)) throw new TypeError(`not a finite number: ${v}`);
  return String(v);
}

function textLit(s) {
  if (s.includes("\u0000")) throw new TypeError("a NUL character cannot reach PostgreSQL text");
  return `'${s.replaceAll("'", "''")}'`;
}

export function sql(strings, ...values) {
  return strings.reduce((acc, s, i) => acc + s + (i < values.length ? lit(values[i]) : ""), "");
}

// ---- values out of rows ----------------------------------------------------------------------

const NUMERIC = (s) => Number(s);
const PARSE = { 16: (s) => s === "t", 20: NUMERIC, 21: NUMERIC, 23: NUMERIC, 26: NUMERIC, 700: NUMERIC, 701: NUMERIC, 1700: NUMERIC, 114: JSON.parse, 3802: JSON.parse };

const convert = (oid, text) => (PARSE[oid] ? PARSE[oid](text) : text);

// ---- the wire ---------------------------------------------------------------------------------

function frame(type, body) {
  const head = Buffer.alloc(type ? 5 : 4);
  if (type) head.write(type, 0, "latin1");
  head.writeInt32BE(body.length + 4, type ? 1 : 0);
  return Buffer.concat([head, body]);
}

const cstring = (s) => Buffer.from(`${s}\u0000`, "utf8");

function startupMessage(o) {
  const params = { user: o.user, database: o.database, client_encoding: "UTF8", TimeZone: "UTC", application_name: o.application ?? "invoice" };
  const pairs = Object.entries(params).flatMap(([k, v]) => [cstring(k), cstring(v)]);
  const version = Buffer.alloc(4);
  version.writeInt32BE(PROTOCOL, 0);
  return frame(null, Buffer.concat([version, ...pairs, Buffer.from([0])]));
}

function readFields(body) {
  const fields = {};
  let at = 0;
  while (at < body.length && body[at] !== 0) {
    const code = String.fromCharCode(body[at]);
    const end = body.indexOf(0, at + 1);
    fields[code] = body.toString("utf8", at + 1, end);
    at = end + 1;
  }
  return fields;
}

function rowDescription(body) {
  const count = body.readInt16BE(0);
  const fields = [];
  let at = 2;
  for (let i = 0; i < count; i++) {
    const end = body.indexOf(0, at);
    const name = body.toString("utf8", at, end);
    at = end + 1;
    fields.push({ name, oid: body.readInt32BE(at + 6) });
    at += 18;
  }
  return fields;
}

function dataRow(body, fields) {
  const count = body.readInt16BE(0);
  const row = {};
  let at = 2;
  for (let i = 0; i < count; i++) {
    const len = body.readInt32BE(at);
    at += 4;
    const f = fields[i] ?? { name: `column${i}`, oid: 25 };
    row[f.name] = len < 0 ? null : convert(f.oid, body.toString("utf8", at, at + len));
    at += Math.max(len, 0);
  }
  return row;
}

// ---- SCRAM-SHA-256 ----------------------------------------------------------------------------

const hmac = (key, text) => createHmac("sha256", key).update(text).digest();
const sha256 = (b) => createHash("sha256").update(b).digest();

function scramStart() {
  const nonce = randomBytes(18).toString("base64");
  return { nonce, bare: `n=,r=${nonce}` };
}

function scramProof(state, serverFirst, password) {
  const attrs = Object.fromEntries(serverFirst.split(",").map((kv) => [kv[0], kv.slice(2)]));
  if (!attrs.r?.startsWith(state.nonce)) throw new Error("SCRAM: the server's nonce does not extend ours");
  const salted = pbkdf2Sync(password, Buffer.from(attrs.s, "base64"), Number(attrs.i), 32, "sha256");
  const clientKey = hmac(salted, "Client Key");
  const withoutProof = `c=biws,r=${attrs.r}`;
  const message = `${state.bare},${serverFirst},${withoutProof}`;
  const signature = hmac(sha256(clientKey), message);
  const proof = Buffer.from(clientKey.map((b, i) => b ^ signature[i]));
  state.serverSignature = hmac(hmac(salted, "Server Key"), message);
  return `${withoutProof},p=${proof.toString("base64")}`;
}

function scramVerify(state, serverFinal) {
  const v = Buffer.from(serverFinal.replace(/^v=/, ""), "base64");
  if (v.length !== state.serverSignature.length || !timingSafeEqual(v, state.serverSignature)) throw new Error("SCRAM: the server's signature does not verify");
}

// ---- one connection ---------------------------------------------------------------------------

class Connection {
  constructor(o) {
    this.o = o;
    this.buf = Buffer.alloc(0);
    this.handler = null;
    this.dead = false;
    this.params = {};
  }

  open() {
    return new Promise((resolve, reject) => {
      const socket = createConnection({ host: this.o.host, port: this.o.port });
      this.socket = socket;
      const timer = setTimeout(() => socket.destroy(new Error(`no PostgreSQL handshake within ${this.o.timeoutMs} ms`)), this.o.timeoutMs);
      this.handler = (type, body) => this.startup(type, body, (e) => { clearTimeout(timer); return e ? reject(e) : resolve(this); });
      socket.on("connect", () => socket.write(startupMessage(this.o)));
      socket.on("data", (chunk) => this.received(chunk));
      socket.on("error", (e) => this.died(e));
      socket.on("close", () => this.died(new Error("the connection to PostgreSQL closed")));
    });
  }

  received(chunk) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    while (this.buf.length >= 5) {
      const len = this.buf.readInt32BE(1);
      if (this.buf.length < 1 + len) return;
      const type = String.fromCharCode(this.buf[0]);
      const body = this.buf.subarray(5, 1 + len);
      this.buf = this.buf.subarray(1 + len);
      this.handler?.(type, body);
    }
  }

  died(e) {
    if (this.dead) return;
    this.dead = true;
    const h = this.handler;
    this.handler = null;
    h?.("!", e);
  }

  startup(type, body, done) {
    if (type === "!") return done(body);
    if (type === "E") return done(new PgError(readFields(body)));
    if (type === "R") return this.authenticate(body, done);
    if (type === "S") return this.parameter(body);
    if (type === "Z") return done(null);
    return null;
  }

  parameter(body) {
    const [k, v] = body.toString("utf8").split("\u0000");
    this.params[k] = v;
  }

  authenticate(body, done) {
    const code = body.readInt32BE(0);
    try {
      if (code === 0) return null;
      if (code === 3) return this.socket.write(frame("p", cstring(this.password())));
      if (code === 5) return this.socket.write(frame("p", cstring(this.md5(body.subarray(4, 8)))));
      if (code === 10) return this.saslStart();
      if (code === 11) return this.socket.write(frame("p", Buffer.from(scramProof(this.scram, body.subarray(4).toString("utf8"), this.password()))));
      if (code === 12) return scramVerify(this.scram, body.subarray(4).toString("utf8"));
      return done(new Error(`PostgreSQL asked for authentication method ${code}, which this client does not speak`));
    } catch (e) {
      this.socket.destroy();
      return done(e);
    }
  }

  password() {
    if (this.o.password === null || this.o.password === undefined) throw new Error("PostgreSQL asked for a password and PGPASSWORD is not set");
    return this.o.password;
  }

  md5(salt) {
    const inner = createHash("md5").update(this.password() + this.o.user).digest("hex");
    return `md5${createHash("md5").update(Buffer.concat([Buffer.from(inner), salt])).digest("hex")}`;
  }

  saslStart() {
    this.scram = scramStart();
    const first = Buffer.from(`n,,${this.scram.bare}`);
    const len = Buffer.alloc(4);
    len.writeInt32BE(first.length, 0);
    this.socket.write(frame("p", Buffer.concat([cstring("SCRAM-SHA-256"), len, first])));
  }

  // -> { rows, command, results }: rows and command of the LAST statement in the string.
  query(text) {
    if (this.dead) return Promise.reject(new Error("the connection to PostgreSQL is closed"));
    return new Promise((resolve, reject) => {
      const st = { fields: null, rows: [], results: [], error: null };
      this.handler = (type, body) => this.answer(st, type, body, resolve, reject);
      this.socket.write(frame("Q", cstring(text)));
    });
  }

  answer(st, type, body, resolve, reject) {
    if (type === "!") return reject(body);
    if (type === "T") {
      st.fields = rowDescription(body);
      st.rows = [];
    } else if (type === "D") {
      st.rows.push(dataRow(body, st.fields ?? []));
    } else if (type === "C") {
      st.results.push({ command: body.toString("utf8", 0, body.length - 1), rows: st.fields ? st.rows : [] });
      st.fields = null;
      st.rows = [];
    } else if (type === "I") {
      st.results.push({ command: null, rows: [] });
    } else if (type === "E") {
      st.error = new PgError(readFields(body));
    } else if (type === "Z") {
      return this.settled(st, String.fromCharCode(body[0]), resolve, reject);
    }
    return null;
  }

  settled(st, status, resolve, reject) {
    this.handler = null;
    if (!st.error) {
      const last = st.results.at(-1) ?? { command: null, rows: [] };
      return resolve({ rows: last.rows, command: last.command, results: st.results });
    }
    if (status !== "E") return reject(st.error);
    return this.query("ROLLBACK").then(() => reject(st.error), () => reject(st.error));
  }

  close() {
    if (this.dead) return;
    this.dead = true;
    this.socket.end(frame("X", Buffer.alloc(0)));
  }
}

// ---- what a role uses -------------------------------------------------------------------------

const pause = (ms) => new Promise((r) => setTimeout(r, ms));

async function connected(o) {
  const deadline = Date.now() + o.waitMs;
  for (;;) {
    try { return await new Connection(o).open(); }
    catch (e) {
      if (Date.now() >= deadline || e instanceof PgError && !/starting up|shutting down|recovery/.test(e.message)) throw e;
      await pause(500);
    }
  }
}

export function createDb(options) {
  const o = { host: "127.0.0.1", port: 5432, user: "postgres", database: "postgres", password: null, timeoutMs: 5000, waitMs: 60000, ...options };
  let conn = null;
  let chain = Promise.resolve();
  const exclusive = (fn) => {
    const p = chain.then(fn, fn);
    chain = p.catch(() => {});
    return p;
  };
  const live = async () => {
    if (!conn || conn.dead) conn = await connected(o);
    return conn;
  };
  return {
    query: (text) => exclusive(async () => (await live()).query(text)),
    tx: (fn) => exclusive(async () => {
      const c = await live();
      await c.query("BEGIN");
      try {
        const out = await fn((text) => c.query(text));
        await c.query("COMMIT");
        return out;
      } catch (e) {
        if (!c.dead) await c.query("ROLLBACK").catch(() => {});
        throw e;
      }
    }),
    close: () => exclusive(async () => conn?.close()),
  };
}
