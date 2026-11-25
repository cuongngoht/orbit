// Docker's multiplexed stream (a container or exec without a TTY): frames of an 8-byte header -- the stream (1 stdout,
// 2 stderr, 3 the daemon's own error), three zero bytes, the payload's length as a big-endian 32-bit number -- and then
// the payload. Bytes are kept as bytes.
export class StdStreamDemuxer {
  private pending: Buffer = Buffer.alloc(0);

  constructor(private readonly onFrame: (stream: "stdout" | "stderr", payload: Buffer) => void) {}

  push(chunk: Buffer): void {
    this.pending = this.pending.length === 0 ? chunk : Buffer.concat([this.pending, chunk]);
    while (this.pending.length >= 8) {
      const size = this.pending.readUInt32BE(4);
      if (this.pending.length < 8 + size) return;
      const kind = this.pending[0];
      const payload = this.pending.subarray(8, 8 + size);
      if (kind === 1) this.onFrame("stdout", payload);
      if (kind === 2 || kind === 3) this.onFrame("stderr", payload);
      this.pending = this.pending.subarray(8 + size);
    }
  }

  // Bytes of an unfinished frame when the stream ended (a truncated stream).
  get leftover(): number {
    return this.pending.length;
  }
}

// The frames of a whole buffer (container logs), split by stream.
export function demuxAll(buffer: Buffer): { stdout: Buffer; stderr: Buffer } {
  const out: Buffer[] = [];
  const err: Buffer[] = [];
  new StdStreamDemuxer((s, b) => (s === "stdout" ? out : err).push(b)).push(buffer);
  return { stdout: Buffer.concat(out), stderr: Buffer.concat(err) };
}
