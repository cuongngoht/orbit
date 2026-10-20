// ONE TASK, LIVE, as Server-Sent Events: the live core's feed (src/live/feed.mjs, ADR 0016) opened over a
// task this checkout owns. What a page receives -- task-event, qa-event, task-view, end -- and the cursor
// every event carries are the feed's; a terminal's `live watch` reads the same feed, so a page and a
// terminal following one journal show the same line in the same place.
//
//   openTaskStream({ ctx, ids, query, lastEventId }) -> { task, start(sink), tick(), close(), cursor() }
//   taskActivity(ctx, ids, query) -> { version, task, cursor, terminal, view, events }
//
// Everything that can refuse happens in `open`, before a single header: an unknown project, a malformed
// id, a task of another checkout -- each is the one JSON failure every route has. The task is read
// through the SAME `show` the page's other reads use, so a stream can never address what a read cannot.
import { ACTIVITY_SOURCE, collectFeed, openFeed, parseCursor, QA_SOURCE, TASK_COMMANDS, TASK_SOURCE } from "../core.mjs";
import { guarded } from "../errors.mjs";
import { taskIdOf, tasksOf } from "../tasks/project.mjs";
import { liveOf } from "./index.mjs";

const CODE = "TASK_READ_FAILED";

export async function openTaskStream({ ctx, ids, query, lastEventId }) {
  const opened = await guarded(CODE, () => openedTask(ctx, ids));
  return { task: opened.task, ...openFeed(feedDeps(ctx), opened, parseCursor(lastEventId ?? query?.since)) };
}

// The same replay a stream opens with, collected instead of sent: what a page paints first, what it
// replays a finished task from, and what it polls when a stream cannot be kept open.
export async function taskActivity(ctx, ids, query) {
  const opened = await guarded(CODE, () => openedTask(ctx, ids));
  return collectFeed(feedDeps(ctx), opened, parseCursor(query?.since));
}

function openedTask(ctx, ids) {
  const taskCtx = tasksOf(ctx, ids);
  const task = taskIdOf(ids[2]);
  const view = TASK_COMMANDS.show.run(taskCtx, [task]);
  return { taskCtx, task, createdAt: view.task.createdAt ?? null, qa: QA_SOURCE.open(taskCtx.root, ctx.world.io), activity: ACTIVITY_SOURCE.open(taskCtx.root) };
}

const feedDeps = (ctx) => ({ io: ctx.world.io, followers: liveOf(ctx).followers, task: TASK_SOURCE, qa: QA_SOURCE, activity: ACTIVITY_SOURCE });
