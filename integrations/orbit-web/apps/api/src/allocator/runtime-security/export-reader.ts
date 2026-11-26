// THE SENSOR'S EXPORT FILE, TAILED (ADR 0063): complete lines only, at most a bound per read, across the sensor's own
// rotation (the live file is renamed and a new one started: the open descriptor keeps the old one readable until it is
// drained, so nothing between the two is skipped). Where it stood is kept in the allocator's state directory, so a
// restarted allocator resumes; where it cannot (the file it stood in is gone), it says so -- a GAP -- and never pretends
// the stream was whole.
import { closeSync, fstatSync, mkdirSync, openSync, readFileSync, readSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

interface Position {
  ino: number;
  offset: number;
}

export class ExportReader {
  private fd: number | null = null;
  private ino = -1;
  private offset = 0;
  private partial = "";
  private gap = false;
  private saved = "";

  constructor(
    private readonly dir: string,
    private readonly stateFile: string | null,
    private readonly fileName = "tetragon.log",
  ) {
    const p = this.load();
    if (p === null) return;
    try {
      const st = statSync(join(this.dir, this.fileName));
      if (st.ino === p.ino && st.size >= p.offset) {
        this.fd = openSync(join(this.dir, this.fileName), "r");
        this.ino = st.ino;
        this.offset = p.offset;
      } else this.gap = true;
    } catch {
      this.gap = true;
    }
  }

  private load(): Position | null {
    if (this.stateFile === null) return null;
    try {
      const p = JSON.parse(readFileSync(this.stateFile, "utf8")) as Position;
      return Number.isSafeInteger(p.ino) && Number.isSafeInteger(p.offset) ? p : null;
    } catch {
      return null;
    }
  }

  private persist(): void {
    if (this.stateFile === null) return;
    const text = JSON.stringify({ ino: this.ino, offset: this.offset });
    if (text === this.saved) return;
    try {
      mkdirSync(dirname(this.stateFile), { recursive: true, mode: 0o700 });
      writeFileSync(`${this.stateFile}.tmp`, text, { mode: 0o600 });
      renameSync(`${this.stateFile}.tmp`, this.stateFile);
      this.saved = text;
    } catch {
      // Where it stood is a convenience for a restart; the stream does not depend on it.
    }
  }

  private open(): boolean {
    try {
      this.fd = openSync(join(this.dir, this.fileName), "r");
      this.ino = fstatSync(this.fd).ino;
      this.offset = 0;
      this.partial = "";
      return true;
    } catch {
      this.fd = null;
      return false;
    }
  }

  private drain(maxBytes: number, out: string[]): number {
    if (this.fd === null) return 0;
    const buf = Buffer.alloc(Math.min(maxBytes, 1024 * 1024));
    let read = 0;
    while (read < maxBytes) {
      const n = readSync(this.fd, buf, 0, Math.min(buf.length, maxBytes - read), this.offset);
      if (n <= 0) break;
      this.offset += n;
      read += n;
      const text = this.partial + buf.subarray(0, n).toString("utf8");
      const lines = text.split("\n");
      this.partial = lines.pop() ?? "";
      for (const l of lines) if (l.trim() !== "") out.push(l);
    }
    return read;
  }

  read(maxBytes: number): { lines: string[]; gap: boolean } {
    const out: string[] = [];
    if (this.fd === null && !this.open()) return { lines: out, gap: this.takeGap() };
    let read = this.drain(maxBytes, out);
    // Rotated: the live name now points at a new file. What the old one still held was just drained; go on in the new.
    let current: number | null = null;
    try {
      current = statSync(join(this.dir, this.fileName)).ino;
    } catch {
      current = null;
    }
    if (read < maxBytes && current !== null && current !== this.ino) {
      if (this.fd !== null) closeSync(this.fd);
      this.fd = null;
      if (this.open()) read += this.drain(maxBytes - read, out);
    }
    this.persist();
    return { lines: out, gap: this.takeGap() };
  }

  private takeGap(): boolean {
    const g = this.gap;
    this.gap = false;
    return g;
  }

  close(): void {
    if (this.fd !== null) closeSync(this.fd);
    this.fd = null;
  }
}
