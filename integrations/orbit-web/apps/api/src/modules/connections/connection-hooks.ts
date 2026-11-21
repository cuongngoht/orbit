// WHAT OTHER CONTEXTS DO WHEN AN AI CONNECTION MOVES, registered by them (so the connections module imports none of
// them): a connection created, changed, checked, disconnected or removed, said after it is written. The execution and
// workforce contexts subscribe here -- a disconnected connection's work in progress is theirs to stop and reconcile, its
// employees theirs to show "not ready"; this module only says it happened (and the app stream's `connections.changed`
// tells the pages).
import { Injectable, Logger } from "@nestjs/common";
import type { AuthState, ConnectionChange, RuntimeKind } from "@orbit-web/contracts";

export interface ConnectionEvent {
  accountId: string;
  connectionId: string;
  runtime: RuntimeKind;
  change: ConnectionChange;
  auth: AuthState;
}

type Hook = (e: ConnectionEvent) => Promise<void> | void;

@Injectable()
export class ConnectionHooks {
  private readonly logger = new Logger("ConnectionHooks");
  private readonly hooks: Hook[] = [];

  onChanged(hook: Hook): void {
    this.hooks.push(hook);
  }

  // After the fact: one hook failing never stops the others, nor the change.
  async changed(e: ConnectionEvent): Promise<void> {
    for (const hook of this.hooks) {
      try {
        await hook(e);
      } catch (err) {
        this.logger.error(`after connection ${e.connectionId} was ${e.change}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
}
