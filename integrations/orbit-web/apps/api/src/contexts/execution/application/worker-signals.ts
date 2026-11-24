// THE WORKER'S NAME AND ITS DOORBELL (Execution): the name this process's worker leases what it admits under (an
// attempt, a conversation run) -- shared with whoever drives a conversation run it admitted, which renews that lease --
// and a way for another context to ask it for a pass soon (a run was requested) without holding the worker itself.
import { Injectable } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { hostname } from "node:os";

@Injectable()
export class WorkerSignals {
  readonly owner = `${hostname()}:${process.pid}:${randomBytes(4).toString("hex")}`;
  private readonly listeners = new Set<() => void>();

  onKick(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // Ask for a pass soon (the worker coalesces them).
  kick(): void {
    for (const l of this.listeners) l();
  }
}
