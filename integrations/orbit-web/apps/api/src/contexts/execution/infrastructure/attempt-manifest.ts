// WHAT ONE ATTEMPT WAS GIVEN TO READ (workforce.attempt_inputs), and why each: written before the attempt starts, read
// by the input reader -- an attempt is served only what its own manifest names -- and by the access watch.
import { Inject, Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import { Db } from "../../../infra/db/db.js";
import type { StagedInput } from "../application/attempt-inputs.js";

const rowOf = (r: Record<string, unknown>): StagedInput => ({ name: String(r.name), storePath: String(r.store_path), origin: String(r.origin) as StagedInput["origin"], ref: r.ref === null ? null : String(r.ref), why: "" });

@Injectable()
export class AttemptManifest {
  constructor(@Inject(Db) private readonly db: Db) {}

  // The manifest of a run, written whole (a dispatch recovered by its key writes it again): its digest.
  async write(orbitId: string, runId: string, inputs: readonly StagedInput[]): Promise<string> {
    const at = new Date().toISOString();
    await this.db.tx(async () => {
      await this.db.query("DELETE FROM workforce.attempt_inputs WHERE account_id = $1 AND run_id = $2", [orbitId, runId]);
      for (const i of inputs) {
        await this.db.query("INSERT INTO workforce.attempt_inputs (account_id, run_id, name, store_path, origin, ref, staged_at) VALUES ($1, $2, $3, $4, $5, $6, $7)", [orbitId, runId, i.name, i.storePath, i.origin, i.ref, at]);
      }
    });
    return createHash("sha256").update(JSON.stringify(inputs.map((i) => [i.name, i.storePath, i.origin, i.ref]))).digest("hex");
  }

  async get(orbitId: string, runId: string, name: string): Promise<StagedInput | null> {
    const r = await this.db.one("SELECT name, store_path, origin, ref FROM workforce.attempt_inputs WHERE account_id = $1 AND run_id = $2 AND name = $3", [orbitId, runId, name]);
    return r === null ? null : rowOf(r);
  }

  async of(orbitId: string, runId: string): Promise<StagedInput[]> {
    return (await this.db.query("SELECT name, store_path, origin, ref FROM workforce.attempt_inputs WHERE account_id = $1 AND run_id = $2 ORDER BY name", [orbitId, runId])).map(rowOf);
  }
}
