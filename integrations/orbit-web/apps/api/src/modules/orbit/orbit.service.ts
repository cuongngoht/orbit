// The Orbit panel of a session: read on request, and again -- a SUBSCRIBER of the session stream -- (debounced) when a
// tool answers and at once when a run ends. `orbit.updated` / `verification.updated` are published only when what
// Orbit says changed. A deleted chat (app stream `session.removed`) is forgotten.
import { Inject, Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { UNKNOWN_VERDICT, type OrbitPanel } from "@orbit-web/contracts";
import { existsSync } from "node:fs";
import type { AppConfig } from "../../config/config.js";
import { EventBus } from "../../core/events/event-bus.js";
import { APP_CONFIG } from "../../core/tokens.js";
import { notFound } from "../../common/errors.js";
import { SessionStore, type SessionRecord } from "../../infra/storage/stores.js";
import { emptyPanel, mapOrbitPanel, parseJson } from "./orbit-status.mapper.js";
import { isTaskId, OrbitGateway } from "./orbit.gateway.js";

const changeKey = (p: OrbitPanel): string => JSON.stringify({ ...p, checkedAt: null });

@Injectable()
export class OrbitService implements OnModuleInit {
  private readonly logger = new Logger("Orbit");
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private readonly last = new Map<string, OrbitPanel>();
  private readonly reading = new Map<string, Promise<OrbitPanel>>();

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(SessionStore) private readonly sessions: SessionStore,
    @Inject(OrbitGateway) private readonly gateway: OrbitGateway,
    @Inject(EventBus) private readonly bus: EventBus,
  ) {}

  onModuleInit(): void {
    this.bus.subscribe({ stream: "session", types: ["tool.completed", "tool.failed"] }, (e) => {
      if (e.sessionId !== null) this.schedule(e.sessionId);
    });
    this.bus.subscribe({ stream: "session", types: ["session.completed", "session.failed", "session.interrupted"] }, (e) => {
      if (e.sessionId !== null) this.schedule(e.sessionId, true);
    });
    this.bus.subscribe({ stream: "app", types: ["session.removed"] }, (e) => {
      if (e.type === "session.removed") this.forget(e.data.sessionId);
    });
  }

  async panel(sessionId: string): Promise<OrbitPanel> {
    const session = await this.sessions.get(sessionId);
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
    try {
      const session = await this.sessions.get(sessionId);
      if (!session) return;
      await this.refresh(session);
    } catch (err) {
      this.logger.warn(`Orbit panel of ${sessionId} could not be read: ${err instanceof Error ? err.message : String(err)}`);
    }
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
    const live = await this.gateway.liveStatus(cwd, session.accountId, session.claudeSessionId);
    const task = parseJson(live.stdout)?.association;
    const taskId = typeof task === "object" && task !== null ? (task as { task?: unknown }).task : null;
    if (!isTaskId(taskId)) return mapOrbitPanel({ live, task: null, context: null, checkedAt });
    const [shown, context] = await Promise.all([this.gateway.taskShow(cwd, session.accountId, taskId, session.claudeSessionId), this.gateway.engineeringContext(cwd, session.accountId, taskId, session.claudeSessionId)]);
    return mapOrbitPanel({ live, task: shown, context, checkedAt });
  }

  private async publishIfChanged(sessionId: string, panel: OrbitPanel): Promise<OrbitPanel> {
    const previous = this.last.get(sessionId);
    this.last.set(sessionId, panel);
    if (previous !== undefined && changeKey(previous) === changeKey(panel)) return panel;
    if (!(await this.sessions.get(sessionId))) return panel;
    await this.bus.publishSession(sessionId, "orbit.updated", { panel });
    const before = previous?.verdict ?? UNKNOWN_VERDICT("");
    if (previous === undefined || before.word !== panel.verdict.word || before.source !== panel.verdict.source) {
      await this.bus.publishSession(sessionId, "verification.updated", { word: panel.verdict.word, label: panel.verdict.label, source: panel.verdict.source });
    }
    return panel;
  }
}
