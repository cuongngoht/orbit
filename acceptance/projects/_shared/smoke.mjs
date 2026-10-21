#!/usr/bin/env node
// The SMOKE for the synthetic invoice application: assemble a stack, bring it up with docker
// compose on free loopback ports, check the fixture's accepted behaviour end to end through its
// own interfaces (the API, the test hooks, the broker, the sink, and psql in the db container),
// and bring it all down again, volumes included.
//
//   node acceptance/projects/_shared/smoke.mjs [--stack=invoice-a | invoice-b | all] [--variant=<name>] [--keep]
//
// It is a check of the FIXTURE, not of Orbit: it knows the stack's names on purpose. Exit 0 only
// when every check of every stack it ran passed -- so on a defective --variant a non-zero exit is
// the expected answer, and which checks failed is the ground truth that variant plants.
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { assemble } from "../assemble.mjs";

const SCHEDULE = "billing-daily";
const OCC_1 = `${SCHEDULE}:2026-10-22T09:00:00+07:00`;
const OCC_2 = `${SCHEDULE}:2026-10-23T09:00:00+07:00`;
const OCC_3 = `${SCHEDULE}:2026-10-24T09:00:00+07:00`;
const BK_1 = `tenant-a|inv-a|${OCC_1}`;
const BK_2 = `tenant-a|inv-a|${OCC_2}`;
const BK_3 = `tenant-a|inv-a|${OCC_3}`;
const PROJECTS = { "invoice-a": "orbit-accept-smoke", "invoice-b": "orbit-accept-smoke-b" };

const pause = (ms) => new Promise((r) => setTimeout(r, ms));

function freePort() {
  return new Promise((res, rej) => {
    const s = createServer();
    s.once("error", rej);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => res(port));
    });
  });
}

class Failure extends Error {}

function must(ok, what) {
  if (!ok) throw new Failure(what);
}

async function waitFor(what, fn, { timeoutMs = 30000, everyMs = 250 } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const got = await fn();
    if (got) return got;
    if (Date.now() >= deadline) throw new Failure(`timed out after ${timeoutMs} ms waiting for ${what}`);
    await pause(everyMs);
  }
}

// ---- the stack under test ---------------------------------------------------------------------

// Per run: random secrets for the sink and the test hooks, which this run turns on.
function stackOf(name, dir, project, ports) {
  const secrets = { sink: randomBytes(24).toString("hex"), hooks: randomBytes(24).toString("hex") };
  const env = { ...process.env, INVOICE_API_PORT: String(ports.api), INVOICE_SINK_PORT: String(ports.sink), INVOICE_HOOKS_PORT: String(ports.hooks), INVOICE_BROKER_PORT: String(ports.broker), ORBIT_SINK_TOKEN: secrets.sink, ORBIT_TEST_HOOKS: "on", ORBIT_TEST_HOOKS_TOKEN: secrets.hooks };
  const compose = (args, opts = {}) => spawnSync("docker", ["compose", "-p", project, ...args], { cwd: dir, env, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, ...opts });
  const base = (port) => `http://127.0.0.1:${port}`;
  return {
    name,
    dir,
    project,
    ports,
    secrets,
    compose,
    origin: base(ports.api),
    psql(query) {
      const r = compose(["exec", "-T", "db", "psql", "-U", "invoice", "-d", "invoice", "-X", "-At", "-F", "|", "-v", "ON_ERROR_STOP=1", "-c", query]);
      if (r.status !== 0) throw new Error(`psql failed: ${r.stderr.trim()}`);
      return r.stdout.split("\n").filter(Boolean).map((line) => line.split("|"));
    },
    count(query) {
      return Number(this.psql(query)[0]?.[0] ?? NaN);
    },
    async http(port, method, path, { token, body, headers = {}, redirect = "manual" } = {}) {
      const r = await fetch(`${base(port)}${path}`, { method, redirect, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { "content-type": "application/json" } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(60000) });
      const text = await r.text();
      let json = null;
      try { json = JSON.parse(text); } catch { json = null; }
      return { status: r.status, json, text, headers: r.headers };
    },
    async form(path, fields, headers = {}) {
      const r = await fetch(`${base(ports.api)}${path}`, { method: "POST", redirect: "manual", headers: { "content-type": "application/x-www-form-urlencoded", ...headers }, body: new URLSearchParams(fields).toString(), signal: AbortSignal.timeout(60000) });
      return { status: r.status, text: await r.text(), headers: r.headers };
    },
    api(method, path, o) { return this.http(ports.api, method, path, o); },
    hooks(method, path, body, token = secrets.hooks) { return this.http(ports.hooks, method, path, { body, token }); },
    sink(path, token = secrets.sink) { return this.http(ports.sink, "GET", path, { token }); },
  };
}

// ---- what each stack's broker needs to publish on its own --------------------------------------

const BROKERS = {
  "invoice-a": {
    async publish(stack, m) {
      const { connect } = await import(pathToFileURL(join(stack.dir, "vendor", "amqp", "index.mjs")).href);
      const conn = await connect({ host: "127.0.0.1", port: stack.ports.broker, user: "invoice", password: "invoice-pass", heartbeatSec: 0 });
      try {
        const ch = await conn.channel();
        await ch.confirmSelect();
        const r = await ch.publish({ exchange: "billing", routingKey: "billing.reminder.requested", mandatory: true, body: Buffer.from(m.body), properties: { messageId: m.messageId, correlationId: m.correlationId, contentType: "application/json", deliveryMode: 2 } });
        return { outcome: r.outcome === "ack" ? "confirmed" : r.outcome, duplicate: false };
      } finally {
        await conn.close().catch(() => {});
      }
    },
    async deadLettered(stack) {
      const { connect } = await import(pathToFileURL(join(stack.dir, "vendor", "amqp", "index.mjs")).href);
      const conn = await connect({ host: "127.0.0.1", port: stack.ports.broker, user: "invoice", password: "invoice-pass", heartbeatSec: 0 });
      try {
        const ch = await conn.channel();
        return (await ch.declareQueue({ name: "billing.reminders.dead", passive: true })).messageCount;
      } finally {
        await conn.close().catch(() => {});
      }
    },
  },
  "invoice-b": {
    async publish(stack, m) {
      const { connect } = await import(pathToFileURL(join(stack.dir, "nats.mjs")).href);
      const nc = await connect({ host: "127.0.0.1", port: stack.ports.broker, user: "invoice", password: "invoice-pass" });
      try {
        const reply = await nc.request("billing.reminder.requested", Buffer.from(m.body), { headers: { "Nats-Msg-Id": m.messageId, "Correlation-Id": m.correlationId }, timeoutMs: 5000 });
        const ack = JSON.parse(reply.data.toString("utf8"));
        return { outcome: ack.error ? "rejected" : "confirmed", duplicate: ack.duplicate === true };
      } finally {
        nc.close();
      }
    },
    async deadLettered(stack) {
      const { connect } = await import(pathToFileURL(join(stack.dir, "nats.mjs")).href);
      const nc = await connect({ host: "127.0.0.1", port: stack.ports.broker, user: "invoice", password: "invoice-pass" });
      try {
        const info = JSON.parse((await nc.request("$JS.API.STREAM.INFO.BILLING_DEAD", Buffer.alloc(0), { timeoutMs: 5000 })).data.toString("utf8"));
        return info.state?.messages ?? NaN;
      } finally {
        nc.close();
      }
    },
  },
};

// ---- the checks -------------------------------------------------------------------------------

// The next period: the injected clock moved to it where the stack has one, else dispatched.
async function dispatch(stack, st, occurrenceId) {
  const r = st.clock === "live"
    ? await stack.hooks("POST", "/orbit/clock/v1/advance", { to: occurrenceId.slice(SCHEDULE.length + 1) })
    : await stack.hooks("POST", "/orbit/scheduler/v1/trigger", { schedule: SCHEDULE, occurrenceId });
  must(r.status === 200, `${r.status} ${r.text}`);
}

const reminders = (stack, bk) => stack.count(`SELECT count(*) FROM reminders WHERE business_key = '${bk}'`);
const notifications = async (stack, bk) => (await stack.sink(`/notifications?tenant=${encodeURIComponent(bk.split("|")[0])}&key=${encodeURIComponent(bk)}`)).json?.notifications ?? [];
const decisionsSince = async (stack, seq) => (await stack.hooks("GET", `/orbit/scheduler/v1/decisions?since=${seq}`)).json;
const attemptsSince = async (stack, seq) => (await stack.hooks("GET", `/orbit/workload/v1/attempts?since=${seq}&workload=worker`)).json;

async function oneEffect(stack, bk, deadlineMs = 120000) {
  await waitFor(`one reminder and one notification for ${bk}`, async () => (await reminders(stack, bk)) >= 1 && (await notifications(stack, bk)).length >= 1, { timeoutMs: deadlineMs });
  await pause(1500);
  const r = await reminders(stack, bk);
  const n = await notifications(stack, bk);
  must(r === 1, `exactly one reminder for ${bk} (found ${r})`);
  must(n.length === 1, `exactly one notification for ${bk} (found ${n.length})`);
  return n[0];
}

function checksFor(stack, broker, st) {
  return [
    ["identities are issued by the test hook", async () => {
      for (const [principal, tenant] of [["tenant-a-reader", "tenant-a"], ["tenant-b-reader", "tenant-b"], ["tenant-a-writer", "tenant-a"]]) {
        const r = await stack.hooks("POST", "/orbit/identity/v1/issue", { principal, tenant });
        must(r.status === 200 && typeof r.json?.token === "string", `issue ${principal}: ${r.status} ${r.text}`);
        st.tokens[principal] = r.json.token;
      }
      const bad = await stack.hooks("POST", "/orbit/identity/v1/issue", { principal: "x", tenant: "tenant-z" });
      must(bad.status === 404 && bad.json?.error === "unknown-tenant", `an unknown tenant is refused (${bad.status})`);
    }],
    ["API-AC-1: the owner reads inv-a (200)", async () => {
      const r = await stack.api("GET", "/api/invoices/inv-a", { token: st.tokens["tenant-a-reader"] });
      must(r.status === 200 && r.json?.id === "inv-a" && r.json?.tenantId === "tenant-a" && r.json?.marker === "canary-invoice-a", `${r.status} ${r.text}`);
    }],
    ["API-AC-2: another tenant gets 404 not_found and no invoice data", async () => {
      const r = await stack.api("GET", "/api/invoices/inv-a", { token: st.tokens["tenant-b-reader"] });
      must(r.status === 404 && r.json?.error === "not_found" && !r.text.includes("canary-invoice-a"), `${r.status} ${r.text}`);
    }],
    ["no identity is 401", async () => {
      const r = await stack.api("GET", "/api/invoices/inv-a");
      must(r.status === 401 && r.json?.error === "unauthorized", `${r.status} ${r.text}`);
    }],
    ["UI-AC-1's call: search is tenant-scoped (200)", async () => {
      const a = await stack.api("GET", "/api/invoices?q=Synthetic%20invoice", { token: st.tokens["tenant-a-reader"] });
      must(a.status === 200 && a.json?.invoices?.length === 1 && a.json.invoices[0].id === "inv-a", `tenant A: ${a.status} ${a.text}`);
      const b = await stack.api("GET", "/api/invoices?q=Synthetic%20invoice", { token: st.tokens["tenant-b-reader"] });
      must(b.status === 200 && b.json?.invoices?.every((i) => i.tenantId === "tenant-b"), `tenant B: ${b.status} ${b.text}`);
      must(stack.count("SELECT count(*) FROM invoices WHERE name = 'Synthetic invoice A'") === 1, "the seeded NAME is one row (the docx's sql witness)");
    }],
    ["the page signs in by a same-origin POST and carries its test ids", async () => {
      const login = await stack.form("/login", { token: st.tokens["tenant-a-reader"], next: "/invoices" }, { origin: stack.origin });
      const cookie = (login.headers.get("set-cookie") ?? "").split(";")[0];
      must(login.status === 303 && login.headers.get("location") === "/invoices" && /^session=[A-Za-z0-9_-]{40,}$/.test(cookie), `login: ${login.status} ${login.headers.get("location")}`);
      must(!cookie.includes(st.tokens["tenant-a-reader"]), "the cookie is a session id, never the token");
      const page = await stack.api("GET", "/invoices", { headers: { cookie } });
      must(page.status === 200 && ["search", "search-submit", "results"].every((id) => page.text.includes(`data-testid="${id}"`)), `page: ${page.status}`);
      must(!/unsafe-inline/.test(page.headers.get("content-security-policy") ?? "unsafe-inline"), "the page's CSP allows no inline script");
      const script = await stack.api("GET", "/assets/invoices.js");
      must(script.status === 200 && /javascript/.test(script.headers.get("content-type") ?? ""), `the page's script: ${script.status}`);
      const anon = await stack.api("GET", "/invoices");
      must(anon.status === 303 && anon.headers.get("location")?.startsWith("/login"), `an anonymous page view goes to /login (${anon.status})`);
      const out = await stack.form("/logout", {}, { origin: stack.origin, cookie });
      must(out.status === 303 && (await stack.api("GET", "/invoices", { headers: { cookie } })).status === 303, "signing out ends the session");
    }],
    ["sign-in never takes a token in a URL, a foreign origin or an open redirect", async () => {
      const token = st.tokens["tenant-a-reader"];
      const inUrl = await stack.api("GET", `/login?token=${token}`);
      must(inUrl.status === 400 && !inUrl.headers.get("set-cookie"), `a token in the URL is refused (${inUrl.status})`);
      for (const headers of [{ origin: "http://evil.example" }, { referer: "http://evil.example/page" }, {}, { origin: "null" }]) {
        const r = await stack.form("/login", { token }, headers);
        must(r.status === 403 && !r.headers.get("set-cookie"), `a sign-in with ${JSON.stringify(headers)} is refused (${r.status})`);
      }
      const referred = await stack.form("/login", { token }, { referer: `${stack.origin}/login` });
      must(referred.status === 303, `a same-origin Referer is enough without Origin (${referred.status})`);
      for (const [next, to] of [["/\\evil.example", "/invoices"], ["//evil.example/x", "/invoices"], ["https://evil.example", "/invoices"], ["/%09/evil.example", "/%09/evil.example"], ["/invoices?q=a", "/invoices?q=a"]]) {
        const r = await stack.form("/login", { token, next }, { origin: stack.origin });
        must(r.status === 303 && r.headers.get("location") === to, `next=${next} goes to ${to}, not ${r.headers.get("location")}`);
      }
      const out = await stack.form("/logout", {}, { origin: "http://evil.example" });
      must(out.status === 403, `a cross-origin sign-out is refused (${out.status})`);
    }],
    ["the test hooks and the sink answer only their own bearer secret", async () => {
      for (const token of [null, "wrong-token-of-enough-length", stack.secrets.sink]) {
        const r = await stack.hooks("GET", "/orbit/v1", undefined, token);
        must(r.status === 401 && r.json?.error === "unauthorized" && /Bearer/.test(r.headers.get("www-authenticate") ?? ""), `hooks with ${token === null ? "no token" : "a wrong token"}: ${r.status}`);
      }
      const issue = await stack.http(stack.ports.hooks, "POST", "/orbit/identity/v1/issue", { body: { principal: "intruder-writer", tenant: "tenant-a" } });
      must(issue.status === 401 && !issue.json?.token, `minting an identity without the hooks' secret is refused (${issue.status})`);
      for (const token of [null, stack.secrets.hooks]) {
        const r = await stack.sink("/notifications?tenant=tenant-a", token);
        must(r.status === 401, `sink read with ${token === null ? "no token" : "the hooks' token"}: ${r.status}`);
        const w = await stack.http(stack.ports.sink, "POST", "/notifications", { token, body: { tenantId: "tenant-a" }, headers: { "idempotency-key": "intruder-key" } });
        must(w.status === 401, `sink write with ${token === null ? "no token" : "the hooks' token"}: ${w.status}`);
      }
      const all = await stack.sink("/notifications");
      must(all.status === 400, `a sink read that names no tenant is refused (${all.status})`);
      must(stack.count("SELECT count(*) FROM sink.notifications WHERE idempotency_key = 'intruder-key'") === 0, "nothing was written without the secret");
      must(stack.count("SELECT count(*) FROM tokens WHERE principal = 'intruder-writer'") === 0, "no identity was minted without the secret");
      must(stack.count("SELECT count(*) FROM tokens WHERE length(token_hash) = 64") === stack.count("SELECT count(*) FROM tokens"), "tokens are kept only as their digests");
    }],
    ["the application refuses to start without its secrets", async () => {
      for (const [overrides, says] of [[["-e", "ORBIT_SINK_TOKEN="], "ORBIT_SINK_TOKEN"], [["-e", "ORBIT_SINK_TOKEN=short"], "ORBIT_SINK_TOKEN"], [["-e", "ORBIT_TEST_HOOKS_TOKEN="], "ORBIT_TEST_HOOKS_TOKEN"]]) {
        const r = stack.compose(["run", "--rm", "--no-deps", "-T", ...overrides, "invoice-app", "node", "app/main.mjs", "all"], { timeout: 120000 });
        must(r.status === 2 && `${r.stdout}${r.stderr}`.includes(says), `with ${overrides[1]} it exits 2 naming ${says} (exit ${r.status}: ${`${r.stdout}${r.stderr}`.trim().slice(-200)})`);
      }
    }],
    ["create is idempotent by key, and a reader may not create", async () => {
      const key = `smoke-${Date.now()}`;
      const body = { name: `Smoke invoice ${key}`, amount: 12.5 };
      const first = await stack.api("POST", "/api/invoices", { token: st.tokens["tenant-a-writer"], body, headers: { "idempotency-key": key } });
      const again = await stack.api("POST", "/api/invoices", { token: st.tokens["tenant-a-writer"], body, headers: { "idempotency-key": key } });
      must(first.status === 201 && again.status === 200 && again.json?.id === first.json?.id, `${first.status}/${again.status}`);
      must(stack.count(`SELECT count(*) FROM invoices WHERE idempotency_key = '${key}'`) === 1, "one row for the key");
      const reader = await stack.api("POST", "/api/invoices", { token: st.tokens["tenant-a-reader"], body, headers: { "idempotency-key": `${key}-r` } });
      must(reader.status === 403, `a reader's create is 403 (${reader.status})`);
    }],
    ["before the period: 08:59:59 is evaluated and not due", async () => {
      st.seq = (await decisionsSince(stack, 0)).through;
      if (st.clock !== "live") {
        const r = await stack.hooks("POST", "/orbit/clock/v1/advance", { to: "2026-10-22T08:59:59+07:00" });
        must(r.status === 409 && r.json?.error === "clock-injection-unsupported", `advance without clock injection is 409 (${r.status} ${r.text})`);
        return;
      }
      const r = await stack.hooks("POST", "/orbit/clock/v1/advance", { to: "2026-10-22T08:59:59+07:00" });
      must(r.status === 200 && r.json?.evaluatedThrough === "2026-10-22T08:59:59+07:00", `${r.status} ${r.text}`);
      const d = await decisionsSince(stack, st.seq);
      must(d.decisions.some((x) => x.decision === "not-due" && x.occurrenceId === OCC_1 && x.evaluatedAt === "2026-10-22T08:59:59+07:00"), `a not-due decision for ${OCC_1} at 08:59:59: ${JSON.stringify(d.decisions)}`);
      must(stack.count(`SELECT count(*) FROM billing_jobs WHERE occurrence_id = '${OCC_1}'`) === 0 && (await reminders(stack, BK_1)) === 0, "no job and no effect yet");
      st.seq = d.through;
    }],
    ["FIX-ASYNC-1: the 09:00 period makes one reminder and one notification for inv-a", async () => {
      if (st.clock === "live") {
        const r = await stack.hooks("POST", "/orbit/clock/v1/advance", { to: "2026-10-22T09:00:00+07:00" });
        must(r.status === 200 && r.json?.evaluatedThrough === "2026-10-22T09:00:00+07:00", `${r.status} ${r.text}`);
        const d = await decisionsSince(stack, st.seq);
        const due = d.decisions.find((x) => x.occurrenceId === OCC_1 && x.decision === "due");
        must(due && /^job-\d+$/.test(due.executionRef ?? "") && due.revision === "r1", `a due decision with an execution ref: ${JSON.stringify(d.decisions)}`);
        st.executionRef = due.executionRef;
      } else {
        const r = await stack.hooks("POST", "/orbit/scheduler/v1/trigger", { schedule: SCHEDULE, occurrenceId: OCC_1 });
        must(r.status === 200 && r.json?.occurrenceId === OCC_1 && r.json?.scheduledFor === "2026-10-22T09:00:00+07:00" && /^job-\d+$/.test(r.json?.executionRef ?? ""), `${r.status} ${r.text}`);
        st.executionRef = r.json.executionRef;
      }
      await oneEffect(stack, BK_1);
      must(stack.count(`SELECT count(*) FROM outbox WHERE business_key = '${BK_1}' AND published_at IS NOT NULL`) === 1, "its outbox row was published once confirmed");
      const a = await attemptsSince(stack, 0);
      must(a.attempts.some((x) => x.businessKey === BK_1 && x.outcome === "processed" && x.executionRef === st.executionRef), `a processed attempt linked to ${st.executionRef}`);
      st.messageId = stack.psql(`SELECT message_id FROM outbox WHERE business_key = '${BK_1}'`)[0][0];
      st.attempts = a.through;
    }],
    ["a duplicate publication with the same messageId leaves one reminder", async () => {
      const payload = JSON.stringify({ messageId: st.messageId, invoiceId: "inv-a", tenantId: "tenant-a", occurrenceId: OCC_1, businessKey: BK_1 });
      const sent = await broker.publish(stack, { messageId: st.messageId, correlationId: BK_1, body: payload });
      must(sent.outcome === "confirmed", `the duplicate was accepted by the broker (${sent.outcome})`);
      if (!sent.duplicate) await waitFor("the worker to take the second delivery", async () => (await attemptsSince(stack, st.attempts)).attempts.some((x) => x.messageId === st.messageId));
      st.duplicateDroppedByBroker = sent.duplicate;
      await oneEffect(stack, BK_1, 10000);
      st.attempts = (await attemptsSince(stack, 0)).through;
    }],
    ["a crash after the commit, before the ack, and a restart leave one effect", async () => {
      const armed = await stack.hooks("POST", "/orbit/workload/v1/control", { workload: "worker", action: "fault", point: "after-commit-before-ack" });
      must(armed.status === 200 && armed.json?.status === "armed", `${armed.status} ${armed.text}`);
      await dispatch(stack, st, OCC_2);
      await waitFor("the fault to fire", async () => stack.count("SELECT count(*) FROM fault_events WHERE point = 'after-commit-before-ack'") === 1);
      await waitFor("the worker to be down", async () => (await stack.hooks("GET", "/orbit/workload/v1/status")).json?.workloads?.find((w) => w.workload === "worker")?.actual === "stopped");
      must((await reminders(stack, BK_2)) === 1 && (await notifications(stack, BK_2)).length === 0, "the commit happened and the sink was not reached");
      const restarted = await stack.hooks("POST", "/orbit/workload/v1/control", { workload: "worker", action: "restart" });
      must(restarted.status === 200 && restarted.json?.status === "running", `${restarted.status} ${restarted.text}`);
      await oneEffect(stack, BK_2, 60000);
      const a = await attemptsSince(stack, st.attempts);
      must(a.attempts.some((x) => x.businessKey === BK_2 && x.outcome === "fault") && a.attempts.some((x) => x.businessKey === BK_2 && x.outcome === "duplicate" && x.deliveryAttempt === 2), `a fault, then a redelivery seen as a duplicate: ${JSON.stringify(a.attempts.map((x) => [x.outcome, x.deliveryAttempt]))}`);
      st.attempts = a.through;
    }],
    ["an ack never precedes a durable effect: a crash right after an ack would lose nothing", async () => {
      const armed = await stack.hooks("POST", "/orbit/workload/v1/control", { workload: "worker", action: "fault", point: "after-ack-before-effect" });
      must(armed.status === 200 && armed.json?.status === "armed", `${armed.status} ${armed.text}`);
      await dispatch(stack, st, OCC_3);
      const first = await waitFor("the effect, or a crash after an ack", async () => {
        if (stack.count("SELECT count(*) FROM fault_events WHERE point = 'after-ack-before-effect'") > 0) return "crashed";
        return (await reminders(stack, BK_3)) >= 1 && (await notifications(stack, BK_3)).length >= 1 ? "effect" : null;
      });
      if (first === "crashed") {
        await waitFor("the worker to be down", async () => (await stack.hooks("GET", "/orbit/workload/v1/status")).json?.workloads?.find((w) => w.workload === "worker")?.actual === "stopped");
        await stack.hooks("POST", "/orbit/workload/v1/control", { workload: "worker", action: "restart" });
      }
      await oneEffect(stack, BK_3, 30000);
      st.attempts = (await attemptsSince(stack, 0)).through;
    }],
    ["a poison message is retried, then dead-lettered as schema-invalid", async () => {
      const id = `msg-${"0".repeat(31)}1`;
      const before = await broker.deadLettered(stack);
      const sent = await broker.publish(stack, { messageId: id, correlationId: "poison", body: "{\"messageId\":\"not a reminder\"}" });
      must(sent.outcome === "confirmed", `published (${sent.outcome})`);
      const seen = await waitFor("three attempts ending dead-lettered", async () => {
        const rows = (await attemptsSince(stack, st.attempts)).attempts.filter((x) => x.messageId === id);
        return rows.some((x) => x.outcome === "dead-lettered") ? rows : null;
      });
      must(seen.map((x) => `${x.deliveryAttempt}:${x.outcome}`).join(",") === "1:retry,2:retry,3:dead-lettered" && seen.at(-1).terminalReason === "schema-invalid", JSON.stringify(seen));
      await waitFor("the dead-letter route to hold it", async () => (await broker.deadLettered(stack)) === before + 1, { timeoutMs: 10000 });
    }],
    ["tenant B was never changed", async () => {
      must(stack.count("SELECT count(*) FROM reminders WHERE tenant_id = 'tenant-b'") === 0, "no reminder for tenant B");
      must(stack.count("SELECT count(*) FROM sink.notifications WHERE tenant_id = 'tenant-b'") === 0, "no notification for tenant B");
      must(stack.count("SELECT count(*) FROM invoices WHERE tenant_id = 'tenant-b'") === 1, "tenant B still has its one invoice");
    }],
  ];
}

// ---- one stack, start to finish ---------------------------------------------------------------

async function smoke(name, { keep, variant }) {
  const dir = assemble(name, join(mkdtempSync(join(tmpdir(), `orbit-smoke-${name}-`)), "checkout"), { variant });
  const ports = { api: await freePort(), sink: await freePort(), hooks: await freePort(), broker: await freePort() };
  const stack = stackOf(name, dir, PROJECTS[name], ports);
  const results = [];
  console.log(`\n== ${name}${variant === "correct" ? "" : ` [variant ${variant}]`}: ${dir}  (api ${ports.api} · sink ${ports.sink} · hooks ${ports.hooks} · broker ${ports.broker})`);
  try {
    const up = stack.compose(["up", "-d", "--build", "--wait", "--wait-timeout", "240"], { stdio: ["ignore", "inherit", "inherit"] });
    if (up.status !== 0) throw new Failure(`docker compose up exited ${up.status}`);
    const offered = (await stack.hooks("GET", "/orbit/v1")).json;
    const st = { tokens: {}, clock: offered?.clockInjection ?? "none" };
    console.log(`   clock injection: ${st.clock}`);
    for (const [label, run] of checksFor(stack, BROKERS[name], st)) {
      const started = Date.now();
      try {
        await run();
        results.push({ label, ok: true });
        console.log(`   PASS  ${label}  (${Date.now() - started} ms)`);
      } catch (e) {
        results.push({ label, ok: false, why: e.message });
        console.log(`   FAIL  ${label}: ${e.message}`);
      }
    }
    if (st.duplicateDroppedByBroker) console.log("   note: the broker itself dropped the duplicate publication (message-id dedupe window), so the worker saw it once");
  } catch (e) {
    results.push({ label: "the stack came up", ok: false, why: e.message });
    console.log(`   FAIL  ${e.message}`);
  } finally {
    if (results.some((r) => !r.ok)) console.log(stack.compose(["logs", "--no-color", "--tail", "60", "invoice-app"]).stdout);
    if (!keep) {
      stack.compose(["down", "-v", "--remove-orphans"], { stdio: ["ignore", "ignore", "inherit"] });
      rmSync(resolve(dir, ".."), { recursive: true, force: true });
    }
  }
  return results;
}

const flags = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith("--")).map((a) => a.slice(2).split("=")).map(([k, v]) => [k, v ?? true]));
const stacks = flags.stack === "all" || !flags.stack ? Object.keys(PROJECTS) : [flags.stack];
let failed = 0;
for (const name of stacks) {
  if (!PROJECTS[name]) {
    console.error(`no stack ${name}`);
    process.exit(2);
  }
  const results = await smoke(name, { keep: Boolean(flags.keep), variant: flags.variant ?? "correct" });
  failed += results.filter((r) => !r.ok).length;
  console.log(`== ${name}: ${results.filter((r) => r.ok).length}/${results.length} passed`);
}
process.exit(failed ? 1 : 0);
