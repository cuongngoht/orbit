// Splits a stream of text chunks into lines. A line longer than `maxLine` is dropped whole (and counted), so a
// runaway line can never grow memory without bound.
export class LineSplitter {
  private buffer = "";
  private dropping = false;
  dropped = 0;

  constructor(
    private readonly onLine: (line: string) => void,
    private readonly maxLine = 16 * 1024 * 1024,
  ) {}

  push(chunk: string): void {
    let start = 0;
    for (let i = chunk.indexOf("\n"); i !== -1; i = chunk.indexOf("\n", start)) {
      this.take(chunk.slice(start, i), true);
      start = i + 1;
    }
    this.take(chunk.slice(start), false);
  }

  // The rest, once the stream has ended.
  end(): void {
    if (this.buffer.length > 0 && !this.dropping) this.emit(this.buffer);
    this.buffer = "";
    this.dropping = false;
  }

  private take(piece: string, complete: boolean): void {
    if (!this.dropping) this.buffer += piece;
    if (this.buffer.length > this.maxLine) {
      this.buffer = "";
      if (!this.dropping) this.dropped += 1;
      this.dropping = true;
    }
    if (!complete) return;
    if (!this.dropping) this.emit(this.buffer);
    this.buffer = "";
    this.dropping = false;
  }

  private emit(line: string): void {
    this.onLine(line.endsWith("\r") ? line.slice(0, -1) : line);
  }
}
