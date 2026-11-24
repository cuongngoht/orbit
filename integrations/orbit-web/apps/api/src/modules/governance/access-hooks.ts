// AFTER COMMIT, WHAT MAY HAVE TAKEN AWAY SOMETHING A RUNNING ATTEMPT WAS GIVEN: a department's policy (or the company's)
// published, an employee's grants changed, a source removed. Whoever keeps live attempts honest (the execution context's
// AccessWatch) listens, and checks every live attempt of the account again: an attempt still holding what is no longer
// its to read is stopped. In-process and fail-open: a listener that throws is logged by itself and changes no command.
import { Injectable, Logger } from "@nestjs/common";

export interface AccessChange {
  // Narrowing what to look at: one department's employees, one employee; neither -- the whole account.
  departmentId?: string;
  employeeId?: string;
  cause?: string;
}

@Injectable()
export class AccessHooks {
  private readonly logger = new Logger(AccessHooks.name);
  private readonly listeners: ((accountId: string, change: AccessChange) => void | Promise<void>)[] = [];

  on(listener: (accountId: string, change: AccessChange) => void | Promise<void>): void {
    this.listeners.push(listener);
  }

  changed(accountId: string, change: AccessChange = {}): void {
    for (const l of this.listeners) {
      void Promise.resolve()
        .then(() => l(accountId, change))
        .catch((err: unknown) => this.logger.warn(`an access check after a change failed: ${err instanceof Error ? err.message : String(err)}`));
    }
  }
}
