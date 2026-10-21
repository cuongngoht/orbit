// The newest tasks of a project's store that one provider started, each as a viewer reads it -- its view, its journal
// lines and the session that started it -- for a composition root to hand to a reader that may not reach the task
// subject itself (0.0.4: a declared playbook's history, src/skill-factory/history.mjs). Bounded, and it writes nothing.
//
//   recentOf(ctx, provider, limit?) -> [{ view, events, session }]     ctx: { tasks, now }
import { loadTask } from "./load.mjs";
import { eventsView, taskView } from "./views.mjs";

export const RECENT_TASKS = 200;

const quietly = (fn) => {
  try { return fn(); }
  catch { return null; }
};

const shown = (ctx) => (id) => ((t) => (t ? { view: taskView(t.model, t.now), events: eventsView(t.model).events, session: t.model.meta?.session ?? null } : null))(quietly(() => loadTask(ctx, id)));

export const recentOf = (ctx, provider, limit = RECENT_TASKS) => ctx.tasks.list().slice(-limit).map(shown(ctx)).filter((t) => t && t.view.task.provider === provider);
