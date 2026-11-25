// WHAT ONE RUN MAY USE OF THE EGRESS PROXY, counted as it is used: the connections it holds open (the installation's
// safety cap, always on; the account policy's, when it names one), the connections it opened in the last minute, what it
// downloaded (per run, and per account and UTC day) and its bandwidth (a token bucket the run's connections share).
//
// Every limit but the installation's cap is the account's policy's (`employeeNetwork.limits`), read at each connection:
// a limit published while a run works applies from its next connection on (the run's shared bucket takes the newest
// rate then). Counting lives in this process's memory: a run that a restart cut is run again as a new attempt, and the
// account's downloads of the day are read back from the connection log when it is first seen again.
import type { NetworkLimits } from "@orbit-web/governance-core";

// The installation's cap on the connections one run holds open at once, when it sets none.
export const DEFAULT_MAX_CONNECTIONS_PER_RUN = 256;

// 1 Mbit/s, in bytes a second.
const MBPS = 125_000;
const MINUTE_MS = 60_000;
// A run lives a day at most (its token does): what is kept about one idle longer is let go.
const RUN_KEPT_MS = 24 * 60 * 60 * 1000;

// What the ledger is told about the run a connection belongs to.
export interface LedgerRun {
  id: string;
  accountId: string;
  // The account policy's limits in effect for this connection (null: none).
  limits: NetworkLimits | null;
}

// A token bucket of `rate` bytes a second, holding at most one second's worth. A take is counted at once -- whoever asks
// next waits behind it -- and answers how long to wait before the bytes it took may move.
export class TokenBucket {
  private tokens: number;
  private last: number;

  constructor(
    private rate: number,
    private readonly now: () => number = Date.now,
  ) {
    this.tokens = rate;
    this.last = now();
  }

  private refill(): void {
    const t = this.now();
    this.tokens = Math.min(this.rate, this.tokens + ((t - this.last) / 1000) * this.rate);
    this.last = t;
  }

  setRate(rate: number): void {
    this.refill();
    this.rate = rate;
    this.tokens = Math.min(this.tokens, rate);
  }

  // Milliseconds to wait before `n` bytes may move (0: at once).
  take(n: number): number {
    this.refill();
    this.tokens -= n;
    return this.tokens >= 0 ? 0 : Math.ceil((-this.tokens / this.rate) * 1000);
  }
}

// One admitted connection's account of what it moves.
export interface Meter {
  // `n` bytes arrived from the host for the run: how many of them may pass (fewer once a download limit is reached) and,
  // when one is, why the connection ends.
  down(n: number): { pass: number; cut: string | null };
  // `n` bytes from the run went to the host.
  up(n: number): void;
  // Milliseconds to wait before `n` bytes may move: the run's bandwidth (0 without a limit).
  delay(n: number): number;
  // The connection ended: it is no longer one of the run's open ones (a second call changes nothing).
  release(): void;
  readonly bytesIn: number;
  readonly bytesOut: number;
}

export type Admission = { ok: true; meter: Meter } | { ok: false; reason: string };

interface RunState {
  active: number;
  // When its connections of the last minute were admitted.
  recent: number[];
  downloaded: number;
  bucket: TokenBucket | null;
  seen: number;
}

export interface LedgerOptions {
  // The installation's cap on the connections one run holds open at once (always on).
  maxConnectionsPerRun: number;
  now?: () => number;
}

const utcDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

export class EgressLedger {
  private readonly runs = new Map<string, RunState>();
  // `<account>|<UTC day>` -> bytes the account's runs downloaded that day.
  private readonly days = new Map<string, number>();
  private readonly seeds = new Map<string, Promise<void>>();
  private readonly now: () => number;
  private sweptAt = 0;

  constructor(private readonly o: LedgerOptions) {
    this.now = o.now ?? Date.now;
  }

  // The start of the UTC day `at` falls in, as the connection log is asked for it.
  static dayStart(at: number): string {
    return `${utcDay(at)}T00:00:00.000Z`;
  }

  // The account's downloads of the day so far, read once per account and day from what was recorded (so a restart does
  // not give the account its day again). Asked again by every connection until it is known; only one read runs.
  async seed(accountId: string, read: (since: string) => Promise<number>): Promise<void> {
    const at = this.now();
    const key = `${accountId}|${utcDay(at)}`;
    if (this.days.has(key)) return;
    const pending =
      this.seeds.get(key) ??
      read(EgressLedger.dayStart(at)).then(
        (bytes) => void this.days.set(key, Math.max(bytes, this.days.get(key) ?? 0)),
        () => undefined,
      );
    this.seeds.set(key, pending);
    await pending;
    this.seeds.delete(key);
  }

  // Whether one more connection of the run may open now, under the installation's cap and the limits its account's
  // policy sets for it; admitted, it holds a place among the run's open connections until its meter is released.
  admit(run: LedgerRun): Admission {
    const now = this.now();
    this.sweep(now);
    const state = this.stateOf(run.id, now);
    const limits = run.limits ?? {};
    const refusal = this.refusal(state, run.accountId, limits, now);
    if (refusal !== null) return { ok: false, reason: refusal };
    state.active += 1;
    state.recent.push(now);
    if (limits.bandwidthMbpsPerRun !== undefined) {
      if (state.bucket === null) state.bucket = new TokenBucket(limits.bandwidthMbpsPerRun * MBPS, this.now);
      else state.bucket.setRate(limits.bandwidthMbpsPerRun * MBPS);
    }
    return { ok: true, meter: this.meterOf(state, run.accountId, limits) };
  }

  private stateOf(runId: string, now: number): RunState {
    const state = this.runs.get(runId) ?? { active: 0, recent: [], downloaded: 0, bucket: null, seen: now };
    state.seen = now;
    state.recent = state.recent.filter((t) => t > now - MINUTE_MS);
    this.runs.set(runId, state);
    return state;
  }

  private dayUsed(accountId: string, now: number): number {
    return this.days.get(`${accountId}|${utcDay(now)}`) ?? 0;
  }

  private refusal(state: RunState, accountId: string, limits: NetworkLimits, now: number): string | null {
    const policyCap = limits.concurrentConnectionsPerRun;
    if (state.active >= this.o.maxConnectionsPerRun && (policyCap === undefined || policyCap >= this.o.maxConnectionsPerRun)) return `this run already holds ${state.active} connections open: the installation allows at most ${this.o.maxConnectionsPerRun} at once`;
    if (policyCap !== undefined && state.active >= policyCap) return `this run already holds ${state.active} connections open: its account's policy allows at most ${policyCap} at once`;
    const perMinute = limits.connectionsPerMinutePerRun;
    if (perMinute !== undefined && state.recent.length >= perMinute) return `this run opened ${state.recent.length} connections in the last minute: its account's policy allows ${perMinute} a minute`;
    if (limits.downloadBytesPerRun !== undefined && state.downloaded >= limits.downloadBytesPerRun) return `this run has downloaded ${state.downloaded} bytes: its account's policy allows ${limits.downloadBytesPerRun} bytes a run`;
    const day = this.dayUsed(accountId, now);
    if (limits.downloadBytesPerDay !== undefined && day >= limits.downloadBytesPerDay) return `this account's employees have downloaded ${day} bytes today (UTC): its policy allows ${limits.downloadBytesPerDay} bytes a day`;
    return null;
  }

  private meterOf(state: RunState, accountId: string, limits: NetworkLimits): Meter {
    let released = false;
    let bytesIn = 0;
    let bytesOut = 0;
    const throttled = limits.bandwidthMbpsPerRun !== undefined;
    return {
      get bytesIn() {
        return bytesIn;
      },
      get bytesOut() {
        return bytesOut;
      },
      down: (n: number) => {
        const now = this.now();
        const key = `${accountId}|${utcDay(now)}`;
        const day = this.days.get(key) ?? 0;
        const runRoom = (limits.downloadBytesPerRun ?? Infinity) - state.downloaded;
        const dayRoom = (limits.downloadBytesPerDay ?? Infinity) - day;
        const pass = Math.max(0, Math.min(n, runRoom, dayRoom));
        state.downloaded += pass;
        this.days.set(key, day + pass);
        bytesIn += pass;
        if (pass === n) return { pass, cut: null };
        const cut = runRoom <= dayRoom ? `this run reached ${limits.downloadBytesPerRun} downloaded bytes, its account's policy limit for a run` : `this account's employees reached ${limits.downloadBytesPerDay} downloaded bytes today (UTC), its policy's daily limit`;
        return { pass, cut };
      },
      up: (n: number) => {
        bytesOut += n;
      },
      delay: (n: number) => (throttled && state.bucket !== null ? state.bucket.take(n) : 0),
      release: () => {
        if (released) return;
        released = true;
        state.active -= 1;
      },
    };
  }

  // What is kept about runs idle for a day, and about days before yesterday, is let go (at most once a minute).
  private sweep(now: number): void {
    if (now - this.sweptAt < MINUTE_MS) return;
    this.sweptAt = now;
    for (const [id, s] of this.runs) if (s.active === 0 && s.seen < now - RUN_KEPT_MS) this.runs.delete(id);
    const keep = new Set([utcDay(now), utcDay(now - RUN_KEPT_MS)]);
    for (const key of this.days.keys()) if (!keep.has(key.slice(key.lastIndexOf("|") + 1))) this.days.delete(key);
  }
}
