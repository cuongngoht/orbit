// The Orbit panel of a session: read on request, and again (debounced) at tool boundaries and when a run ends.
// `orbit.updated` / `verification.updated` are emitted only when what Orbit says changed.
import { Inject, Injectable, Logger } from "@nestjs/common";
import { UNKNOWN_VERDICT, type OrbitPanel } from "@orbit-web/contracts";
import { existsSync } from "node:fs";
import type { AppConfig } from "../../config/config.js";
import { EventHub } from "../../core/event-hub.js";
import { APP_CONFIG } from "../../core/tokens.js";
import { notFound } from "../../common/errors.js";
import { SessionStore, type SessionRecord } from "../../infra/storage/stores.js";
import { emptyPanel, mapOrbitPanel, parseJson } from "./orbit-status.mapper.js";
import { isTaskId, OrbitGateway } from "./orbit.gateway.js";

const changeKey = (p: OrbitPanel): string => JSON.stringify({ ...p, checkedAt: null });

@Injectable()
export class OrbitService {
  private readonly logger = new Logger("Orbit");
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private readonly last = new Map<string, OrbitPanel>();
  private readonly reading = new Map<string, Promise<OrbitPanel>>();

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(SessionStore) private readonly sessions: SessionStore,
    @Inject(OrbitGateway) private readonly gateway: OrbitGateway,
    @Inject(EventHub) private readonly hub: EventHub,
  ) {}

  async panel(sessionId: string): Promise<OrbitPanel> {
    const session = this.sessions.get(sessionId);
    if (!session) throw notFound("Session");
    return this.refresh(session);
  }

  // Reads the panel again soon (debounced), or now.
  schedule(sessionId: string, now = false): void {
    if (now) {
      clearTimeout(this.timers.get(sessionId));
      this.timers.delete(sessionId);
      void this.refreshById(sessionId);
      return;
    }
    if (this.timers.has(sessionId)) return;
    const timer = setTimeout(() => {
      this.timers.delete(sessionId);
      void this.refreshById(sessionId);
    }, this.config.limits.orbitRefreshMs);
    timer.unref();
    this.timers.set(sessionId, timer);
  }

  forget(sessionId: string): void {
    clearTimeout(this.timers.get(sessionId));
    this.timers.delete(sessionId);
    this.last.delete(sessionId);
  }

  private async refreshById(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    await this.refresh(session).catch((err: unknown) => this.logger.warn(`Orbit panel of ${sessionId} could not be read: ${err instanceof Error ? err.message : String(err)}`));
  }

  private refresh(session: SessionRecord): Promise<OrbitPanel> {
    const pending = this.reading.get(session.id);
    if (pending) return pending;
    const read = this.read(session)
      .then((panel) => this.publishIfChanged(session.id, panel))
      .finally(() => this.reading.delete(session.id));
    this.reading.set(session.id, read);
    return read;
  }

  private async read(session: SessionRecord): Promise<OrbitPanel> {
    const checkedAt = new Date().toISOString();
    if (session.baseCommit === null || !existsSync(session.workspacePath)) return emptyPanel("unavailable", "The workspace is not ready yet.", checkedAt);
    const cwd = session.workspacePath;
    const live = await this.gateway.liveStatus(cwd, session.claudeSessionId);
    const task = parseJson(live.stdout)?.association;
    const taskId = typeof task === "object" && task !== null ? (task as { task?: unknown }).task : null;
    if (!isTaskId(taskId)) return mapOrbitPanel({ live, task: null, context: null, checkedAt });
    const [shown, context] = await Promise.all([this.gateway.taskShow(cwd, taskId, session.claudeSessionId), this.gateway.engineeringContext(cwd, taskId, session.claudeSessionId)]);
    return mapOrbitPanel({ live, task: shown, context, checkedAt });
  }

  private publishIfChanged(sessionId: string, panel: OrbitPanel): OrbitPanel {
    const previous = this.last.get(sessionId);
    this.last.set(sessionId, panel);
    if (previous !== undefined && changeKey(previous) === changeKey(panel)) return panel;
    if (!this.sessions.get(sessionId)) return panel;
    this.hub.emit(sessionId, "orbit.updated", { panel }, null);
    const before = previous?.verdict ?? UNKNOWN_VERDICT("");
    if (previous === undefined || before.word !== panel.verdict.word || before.source !== panel.verdict.source) {
      this.hub.emit(sessionId, "verification.updated", { word: panel.verdict.word, label: panel.verdict.label, source: panel.verdict.source }, null);
    }
    return panel;
  }
}
