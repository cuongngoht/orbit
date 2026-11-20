// THE CLAUDE SIGN-IN'S OWN WAY OUT (governed deployment). `claude auth login` runs in the agent's container, whose only
// way out is the control plane's egress proxy, and it is not a run: it holds no run's token, so the proxy would decide
// its connections as nobody's -- and the sign-in, which opens Orbit Web before any Constitution can exist, could never
// finish. While one sign-in runs it holds this channel: a token of its own, handed to that process alone, which the
// proxy grants the Claude account's hosts (CLAUDE_ACCOUNT_HOSTS) and nothing else -- never a Constitution's to grant
// or to refuse, so no policy can lock Orbit Web out of its own sign-in -- each connection recorded (egress.sign_in).
// One sign-in runs at a time, so one channel is open at most; it closes when the sign-in ends and lives no longer than
// a sign-in may. Only the token's SHA-256 is kept.
import { Injectable } from "@nestjs/common";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const digestOf = (token: string): Buffer => createHash("sha256").update(token).digest();

@Injectable()
export class SignInChannel {
  private channel: { digest: Buffer; until: number } | null = null;

  // A channel for the sign-in about to start (one still open is replaced: one sign-in runs at a time).
  open(ttlMs: number, now = Date.now()): string {
    const token = randomBytes(32).toString("base64url");
    this.channel = { digest: digestOf(token), until: now + ttlMs };
    return token;
  }

  // Whether a connection carrying this token belongs to the sign-in that runs now.
  holds(token: string, now = Date.now()): boolean {
    const open = this.channel;
    return open !== null && now < open.until && timingSafeEqual(open.digest, digestOf(token));
  }

  close(): void {
    this.channel = null;
  }
}
