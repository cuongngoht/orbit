// THE CREDENTIAL STORE: an AI connection's API key, entered once in the browser and kept here -- one file per connection
// under the control plane's own room (`<data>/control/credentials/<OrbitId>/<connectionId>`, mode 0600, its directories
// 0700), never in a connection's config home and never mounted where an agent runs. The database keeps only its
// reference (`file:<OrbitId>/<connectionId>`). A key is never returned by any route, never logged, never put in an event
// or an audit record: it is read only by whoever starts that connection's own CLI, at that moment.
import { chmodSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const REF = /^file:([0-9a-f-]{36})\/([0-9a-f-]{36})$/;

export class CredentialStore {
  constructor(readonly root: string) {}

  refOf(accountId: string, connectionId: string): string {
    if (!UUID.test(accountId) || !UUID.test(connectionId)) throw new Error("a credential is named by an account's and a connection's ids only");
    return `file:${accountId}/${connectionId}`;
  }

  // Written whole or not at all (a new file, renamed over the old one).
  write(ref: string, secret: string): void {
    const path = this.pathOf(ref);
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    chmodSync(dirname(path), 0o700);
    const temp = `${path}.${randomBytes(6).toString("hex")}.tmp`;
    writeFileSync(temp, secret, { mode: 0o600, flag: "wx" });
    renameSync(temp, path);
  }

  // The secret, or null when there is none (removed, never written).
  read(ref: string | null): string | null {
    if (ref === null) return null;
    try {
      return readFileSync(this.pathOf(ref), "utf8");
    } catch {
      return null;
    }
  }

  remove(ref: string | null): void {
    if (ref === null) return;
    rmSync(this.pathOf(ref), { force: true });
  }

  private pathOf(ref: string): string {
    const m = REF.exec(ref);
    if (m === null || !UUID.test(m[1] as string) || !UUID.test(m[2] as string)) throw new Error("not a credential reference of this store");
    return join(this.root, m[1] as string, m[2] as string);
  }
}
