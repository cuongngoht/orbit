// WHEN AN AI CONNECTION GOES (Execution): a person who disconnects or removes a connection stops the work running on it.
// Every live attempt (starting or running) of that account resolved to that connection is asked to stop; the worker stops
// it like any other stop, and Work blocks the assignment saying why, for a person to connect again and retry. Nothing new
// starts on it either: an employee whose connection is not connected is not ready at dispatch. A check that finds a login
// gone stops nothing here: the attempt's own CLI meets it when it next asks its provider. A CEO's answer in CEO Chat on
// that connection (a conversation run, waiting or live) is asked to stop the same way: its runner ends it, saying why.
import { Inject, Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { ConnectionHooks } from "../../../modules/connections/connection-hooks.js";
import { ConversationRunRepository } from "../infrastructure/conversation-runs.repository.js";
import { RunRepository } from "../infrastructure/runs.repository.js";
import { CONNECTION_GONE } from "./execution.worker.js";

@Injectable()
export class ConnectionWatch implements OnModuleInit {
  private readonly logger = new Logger("ConnectionWatch");

  constructor(
    @Inject(ConnectionHooks) private readonly hooks: ConnectionHooks,
    @Inject(RunRepository) private readonly runs: RunRepository,
    @Inject(ConversationRunRepository) private readonly conversations: ConversationRunRepository,
  ) {}

  onModuleInit(): void {
    this.hooks.onChanged(async (e) => {
      if (e.change !== "disconnected" && e.change !== "removed") return;
      const asked = await this.runs.requestStopOnConnection(e.accountId, e.connectionId, CONNECTION_GONE);
      const answers = await this.conversations.requestStopOnConnection(e.accountId, e.connectionId, CONNECTION_GONE);
      if (asked.length + answers.length > 0) this.logger.log(`The connection ${e.connectionId} was ${e.change}: ${asked.length} attempt(s) and ${answers.length} answer(s) on it asked to stop.`);
    });
  }
}
