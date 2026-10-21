// A FAKE PostgreSQL server for the state adapter's client (skills/orbit-backend-test/postgres/), on a
// real loopback socket: protocol 3.0 startup, the authentication it is told to ask for (trust,
// cleartext, MD5 or SCRAM-SHA-256 -- holding the client to its proof, and proving itself back), a
// simple query, and one extended statement answered from a table of rows the test hands in. It
// keeps what it was sent, so a test can say the statement was READ ONLY and every value a
// parameter. Not a database: it knows `SELECT count(*) FROM … WHERE … = $n` and `SELECT * FROM …`.
import { createHash, createHmac, pbkdf2Sync, randomBytes } from "node:crypto";
import { createServer } from "node:net";

const int32 = (n) => ((b) => (b.writeInt32BE(n), b))(Buffer.alloc(4));
const int16 = (n) => ((b) => (b.writeInt16BE(n), b))(Buffer.alloc(2));
const cstr = (s) => Buffer.concat([Buffer.from(String(s), "utf8"), Buffer.from([0])]);
const msg = (type, body = Buffer.alloc(0)) => Buffer.concat([Buffer.from(type, "latin1"), int32(body.length + 4), body]);
const hmac = (key, text) => createHmac("sha256", key).update(text).digest();

export async function pgPeer({ auth = "trust", user = "invoice", password = "pencil", tables = {}, errorOn = null, lieAboutServer = false } = {}) {
  const seen = { startup: null, queries: [], statements: [], terminated: false };
  const server = createServer((socket) => conversation(socket, { auth, user, password, tables, errorOn, lieAboutServer, seen }));
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { port: server.address().port, seen, close: () => new Promise((r) => server.close(r)) };
}

function conversation(socket, o) {
  const st = { buf: Buffer.alloc(0), started: false, scram: null, inTx: false };
  socket.on("data", (chunk) => {
    st.buf = Buffer.concat([st.buf, chunk]);
    for (let m = next(st); m; m = next(st)) handled(socket, o, st, m);
  });
  socket.on("error", () => {});
}

function next(st) {
  if (!st.started) return st.buf.length >= 4 && st.buf.length >= st.buf.readInt32BE(0) ? taken(st, 0, st.buf.readInt32BE(0), "startup") : null;
  if (st.buf.length < 5) return null;
  const length = st.buf.readInt32BE(1);
  return st.buf.length >= length + 1 ? taken(st, 5, length + 1, String.fromCharCode(st.buf[0])) : null;
}

function taken(st, from, size, type) {
  const body = st.buf.subarray(type === "startup" ? 8 : from, size);
  st.buf = st.buf.subarray(size);
  return { type, body };
}

function handled(socket, o, st, m) {
  const handler = HANDLERS[m.type];
  if (handler) handler(socket, o, st, m.body);
}

const HANDLERS = {
  startup: (socket, o, st, body) => startup(socket, o, st, body),
  p: (socket, o, st, body) => password(socket, o, st, body),
  Q: (socket, o, st, body) => simple(socket, o, st, body.subarray(0, body.indexOf(0)).toString("utf8")),
  P: (socket, o, st, body) => parsed(o, st, body),
  B: (socket, o, st, body) => bound(st, body),
  D: () => {},
  E: () => {},
  S: (socket, o, st) => synced(socket, o, st),
  X: (socket, o) => { o.seen.terminated = true; socket.end(); },
};

function startup(socket, o, st, body) {
  st.started = true;
  const parts = body.toString("utf8").split("\0");
  o.seen.startup = Object.fromEntries(parts.flatMap((p, i) => (i % 2 === 0 && p ? [[p, parts[i + 1]]] : [])));
  if (o.auth === "trust") return ready(socket, msg("R", int32(0)));
  if (o.auth === "cleartext") return socket.write(msg("R", int32(3)));
  if (o.auth === "md5") return socket.write(msg("R", Buffer.concat([int32(5), (st.salt = randomBytes(4))])));
  socket.write(msg("R", Buffer.concat([int32(10), cstr("SCRAM-SHA-256-PLUS"), cstr("SCRAM-SHA-256"), Buffer.from([0])])));
}

const ready = (socket, ...before) => socket.write(Buffer.concat([...before, msg("S", Buffer.concat([cstr("server_version"), cstr("16.4")])), msg("K", Buffer.concat([int32(7), int32(42)])), msg("Z", Buffer.from("I"))]));

const refused = (socket, code, text) => socket.write(Buffer.concat([msg("E", Buffer.concat([cstr("SFATAL"), cstr(`C${code}`), cstr(`M${text}`), Buffer.from([0])]))]));

function password(socket, o, st, body) {
  if (o.auth === "cleartext") return body.subarray(0, body.indexOf(0)).toString("utf8") === o.password ? ready(socket, msg("R", int32(0))) : refused(socket, "28P01", "password authentication failed");
  if (o.auth === "md5") return body.subarray(0, body.indexOf(0)).toString("utf8") === md5Of(o, st.salt) ? ready(socket, msg("R", int32(0))) : refused(socket, "28P01", "password authentication failed");
  return st.scram ? scramFinal(socket, o, st, body.toString("utf8")) : scramFirst(socket, o, st, body);
}

const md5Of = (o, salt) => `md5${createHash("md5").update(Buffer.concat([Buffer.from(createHash("md5").update(`${o.password}${o.user}`).digest("hex")), salt])).digest("hex")}`;

function scramFirst(socket, o, st, body) {
  const mechanism = body.subarray(0, body.indexOf(0)).toString("utf8");
  const first = body.subarray(body.indexOf(0) + 5).toString("utf8");
  const clientNonce = /r=([^,]+)/.exec(first)[1];
  st.scram = { mechanism, bare: first.slice(3), nonce: `${clientNonce}${randomBytes(9).toString("base64")}`, salt: randomBytes(16), iterations: 4096 };
  socket.write(msg("R", Buffer.concat([int32(11), Buffer.from((st.scram.serverFirst = `r=${st.scram.nonce},s=${st.scram.salt.toString("base64")},i=${st.scram.iterations}`))])));
}

function scramFinal(socket, o, st, final) {
  const salted = pbkdf2Sync(o.password, st.scram.salt, st.scram.iterations, 32, "sha256");
  const withoutProof = final.slice(0, final.indexOf(",p="));
  const auth = `${st.scram.bare},${st.scram.serverFirst},${withoutProof}`;
  const clientKey = hmac(salted, "Client Key");
  const expected = Buffer.from(clientKey.map((b, i) => b ^ hmac(createHash("sha256").update(clientKey).digest(), auth)[i])).toString("base64");
  if (final.slice(final.indexOf(",p=") + 3) !== expected) return refused(socket, "28P01", "password authentication failed");
  ready(socket, msg("R", Buffer.concat([int32(12), Buffer.from(`v=${(o.lieAboutServer ? randomBytes(32) : hmac(hmac(salted, "Server Key"), auth)).toString("base64")}`)])), msg("R", int32(0)));
}

function simple(socket, o, st, sql) {
  o.seen.queries.push(sql);
  st.inTx = /^BEGIN/.test(sql) ? true : /^ROLLBACK/.test(sql) ? false : st.inTx;
  socket.write(Buffer.concat([msg("C", cstr(sql.split(" ")[0])), msg("Z", Buffer.from(st.inTx ? "T" : "I"))]));
}

function parsed(o, st, body) {
  const at = body.indexOf(0);
  st.sql = body.subarray(at + 1, body.indexOf(0, at + 1)).toString("utf8");
}

function bound(st, body) {
  let at = body.indexOf(0) + 1;
  at = body.indexOf(0, at) + 1;
  at += 2 + 2 * body.readInt16BE(at);
  const n = body.readInt16BE(at);
  st.params = [];
  for (let i = 0, p = at + 2; i < n; i++) p = paramAt(body, p, st.params);
}

function paramAt(body, p, out) {
  const length = body.readInt32BE(p);
  out.push(length < 0 ? null : body.subarray(p + 4, p + 4 + length).toString("utf8"));
  return p + 4 + Math.max(length, 0);
}

function synced(socket, o, st) {
  o.seen.statements.push({ sql: st.sql, params: st.params, inReadOnlyTx: st.inTx && o.seen.queries.at(-1)?.includes("READ ONLY") });
  if (o.errorOn && st.sql.includes(o.errorOn.when)) return socket.write(Buffer.concat([msg("E", Buffer.concat([cstr("SERROR"), cstr(`C${o.errorOn.code}`), cstr(`M${o.errorOn.text}`), Buffer.from([0])])), msg("Z", Buffer.from("E"))]));
  const answer = answerOf(o, st);
  socket.write(Buffer.concat([msg("1"), msg("2"), rowDescription(answer.columns), ...answer.rows.map(dataRow), msg("C", cstr(`SELECT ${answer.rows.length}`)), msg("Z", Buffer.from("T"))]));
}

// What the fake knows: a count, or every row, of a table the test handed in, where a column equals a parameter.
function answerOf(o, st) {
  const table = /FROM\s+((?:"[^"]+"\.)?"[^"]+")/.exec(st.sql)?.[1]?.replace(/"/g, "") ?? "";
  const where = [...st.sql.matchAll(/"([^"]+)" = \$(\d+)/g)].map((m) => [m[1], st.params[Number(m[2]) - 1]]);
  const rows = (o.tables[table] ?? []).filter((r) => where.every(([c, v]) => String(r[c]) === v));
  return /count\(\*\)/.test(st.sql) ? { columns: ["count"], rows: [[String(rows.length)]] } : { columns: Object.keys(o.tables[table]?.[0] ?? { id: 0 }), rows: rows.slice(0, Number(/LIMIT (\d+)/.exec(st.sql)?.[1] ?? 1000)).map((r) => Object.values(r).map((v) => (v === null ? null : String(v)))) };
}

const rowDescription = (columns) => msg("T", Buffer.concat([int16(columns.length), ...columns.map((c) => Buffer.concat([cstr(c), int32(0), int16(0), int32(25), int16(-1), int32(-1), int16(0)]))]));

const dataRow = (values) => msg("D", Buffer.concat([int16(values.length), ...values.flatMap((v) => (v === null ? [int32(-1)] : ((b) => [int32(b.length), b])(Buffer.from(v, "utf8"))))]));
