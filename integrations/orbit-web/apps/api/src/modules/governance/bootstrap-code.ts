// THE FIRST OWNER'S CODE. While nobody owns governance, Orbit Web makes a one-time code at start (128 random bits),
// keeps only its SHA-256 in memory -- never on disk, never in the database, never in any child's environment -- and
// says the code once, on its own standard output: `docker logs` of the control plane is the installation's own
// channel, which a person who runs the container reads and the Claude Code agent does not (it has no Docker socket,
// and in the governed deployment it runs in another container altogether). The code enrols ONE owner, once: it is
// spent before anything is written, a wrong one is counted, and after a few wrong ones it is withdrawn until the next
// start. A restart makes a new one. Once an owner exists no code is made at all.
//
// The offline door is the installation's own terminal (cli/governance.ts): `init-owner` while nobody owns governance,
// `reset-password` afterwards -- run in the control plane's container, against its database.
import { Inject, Injectable } from "@nestjs/common";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const BOOTSTRAP_ANNOUNCER = Symbol("BOOTSTRAP_ANNOUNCER");

export interface BootstrapAnnouncer {
  announce(code: string): void;
}

// The default channel: the process's own standard output (whatever the logger is set to).
export const stdoutAnnouncer: BootstrapAnnouncer = {
  announce(code: string): void {
    const lines = [
      "",
      "Orbit Web governance has no owner yet. To enrol its first owner, open Orbit Web, choose Governance, and enter",
      "this one-time code (it works once, until Orbit Web restarts, and is shown nowhere else):",
      "",
      `    ${code}`,
      "",
    ];
    process.stdout.write(`${lines.join("\n")}\n`);
  },
};

const MAX_WRONG = 10;

const digestOf = (code: string): Buffer => createHash("sha256").update(code).digest();

// What a person types: case, spaces and dashes do not matter.
export const normalizeCode = (code: string): string => code.toLowerCase().replace(/[^0-9a-f]/g, "");

const grouped = (hex: string): string => hex.match(/.{1,4}/g)?.join("-") ?? hex;

export type CodeCheck = "accepted" | "wrong" | "closed";

@Injectable()
export class BootstrapCode {
  private digest: Buffer | null = null;
  private wrong = 0;

  constructor(@Inject(BOOTSTRAP_ANNOUNCER) private readonly announcer: BootstrapAnnouncer) {}

  isOpen(): boolean {
    return this.digest !== null;
  }

  issue(): void {
    const code = randomBytes(16).toString("hex");
    this.digest = digestOf(code);
    this.wrong = 0;
    this.announcer.announce(grouped(code));
  }

  // Spends the code when it matches -- before anything is written, so it can never be used twice.
  take(code: string): CodeCheck {
    if (this.digest === null) return "closed";
    const given = digestOf(normalizeCode(code));
    if (timingSafeEqual(given, this.digest)) {
      this.digest = null;
      return "accepted";
    }
    this.wrong += 1;
    if (this.wrong >= MAX_WRONG) this.digest = null;
    return "wrong";
  }

  close(): void {
    this.digest = null;
  }
}
