"""Work items -- Azure Boards items, GitHub issues -- by CATEGORY, never by name.

A state is whatever a team called it ("Waiting on Vendor", "In QA"); what it
MEANS is the category the source itself assigns it (proposed, in-progress,
resolved, completed, removed), which the collector recorded beside it. A state
the source gives no category is listed as unmapped and counted nowhere -- a
guess would move work between "done" and "not done" on a hunch.

At the cut-off, an item is in the category its history says it was in then.
It is DONE in a period when its last move into `completed` falls in that period
and it was still completed at the cut-off; an item reopened before the cut-off
is not done, and is counted as reopened. An item moved to `removed` is canceled:
out of the backlog and out of throughput. One item linked to three pull
requests is one item.
"""
from collections import Counter

from .periods import within
from .stats import count, med, pct, share
from .timecal import hours, instant

OPEN = ("proposed", "in-progress", "resolved")


def history(item):
    """[(instant, category, state)], oldest first."""
    rows = [(instant(h.get("at")), h.get("category") or "unknown", h.get("state")) for h in item.get("history") or []]
    return sorted((r for r in rows if r[0] is not None), key=lambda r: r[0])


def category_at(item, moment):
    known = [r for r in history(item) if r[0] < moment]
    return known[-1][1] if known else None


def completed_at(item, cutoff):
    """When it was last completed before the cut-off -- if it was still completed then."""
    moves = [r for r in history(item) if r[0] < cutoff]
    if not moves or moves[-1][1] != "completed":
        return None
    last = max((i for i, r in enumerate(moves) if r[1] == "completed" and (i == 0 or moves[i - 1][1] != "completed")), default=None)
    return moves[last][0] if last is not None else None


def started_at(item, cutoff):
    return next((r[0] for r in history(item) if r[1] == "in-progress" and r[0] < cutoff), None)


def reopened(item, start, cutoff):
    moves = [r for r in history(item) if r[0] < cutoff]
    return sum(1 for a, b in zip(moves, moves[1:]) if a[1] in ("completed", "resolved") and b[1] in ("proposed", "in-progress") and (start is None or b[0] >= start))


def item_facts(item, cutoff, start):
    created = instant(item.get("createdAt"))
    if created is None or created >= cutoff:
        return None
    done, begun = completed_at(item, cutoff), started_at(item, cutoff)
    return {"id": item["id"], "key": item.get("key"), "title": item.get("title") or "", "url": item.get("url"), "type": item.get("type"),
            "kind": item.get("kind") or "other", "created": created, "category": category_at(item, cutoff) or "unknown",
            "state": state_at(item, cutoff), "done": done, "started": begun, "reopened": reopened(item, start, cutoff),
            "canceledAt": canceled_at(item, cutoff), "hoursCycle": hours(begun, done), "hoursLead": hours(created, done),
            "ageDays": round((cutoff - created).total_seconds() / 86400, 1), "pointInTime": item.get("pointInTime", True),
            "iteration": item.get("iteration"), "parent": item.get("parent")}


def state_at(item, moment):
    known = [r for r in history(item) if r[0] < moment]
    return known[-1][2] if known else item.get("state")


def canceled_at(item, cutoff):
    moves = [r for r in history(item) if r[0] < cutoff]
    return moves[-1][0] if moves and moves[-1][1] == "removed" else None


def period_items(p, facts):
    return {"itemsCompleted": count(facts, lambda f: within(f["done"], p)), "itemsStarted": count(facts, lambda f: within(f["started"], p)),
            "itemsCreated": count(facts, lambda f: within(f["created"], p)), "bugsCompleted": count(facts, lambda f: f["kind"] == "bug" and within(f["done"], p)),
            "itemsCanceled": count(facts, lambda f: within(f["canceledAt"], p))}


def summary(facts, start, types):
    in_window = [f for f in facts if f["done"] and (start is None or f["done"] >= start)]
    backlog = [f for f in facts if f["category"] in OPEN]
    return {"completed": len(in_window), "cycleTimeH": pct([f["hoursCycle"] for f in in_window]), "leadTimeH": pct([f["hoursLead"] for f in in_window]),
            "reopened": sum(f["reopened"] for f in facts), "canceled": count(facts, lambda f: f["canceledAt"] and (start is None or f["canceledAt"] >= start)),
            "backlog": backlog_of(backlog), "unmapped": unmapped(facts, types), "notPointInTime": count(facts, lambda f: not f["pointInTime"])}


def backlog_of(rows):
    by = Counter(f["category"] for f in rows)
    oldest = sorted(rows, key=lambda f: f["created"])[:25]
    return {"total": len(rows), "byCategory": dict(by), "byKind": dict(Counter(f["kind"] for f in rows)), "byType": dict(Counter(f["type"] for f in rows)),
            "medianAgeDays": med([f["ageDays"] for f in rows]),
            "oldest": [{"key": f["key"], "title": f["title"], "url": f["url"], "type": f["type"], "state": f["state"], "category": f["category"], "ageDays": f["ageDays"]} for f in oldest]}


def unmapped(facts, types):
    known = {(t.get("name"), s.get("name")) for t in types or [] for s in t.get("states") or [] if s.get("category")}
    rows = Counter((f["type"], f["state"]) for f in facts if f["category"] == "unknown" and (f["type"], f["state"]) not in known)
    return [{"type": t, "state": s, "items": n} for (t, s), n in rows.most_common()]


def throughput(periods, facts, kinds):
    wanted = [f for f in facts if f["kind"] in kinds]
    return [{"label": p["label"], "partial": p["partial"], "completed": count(wanted, lambda f: within(f["done"], p))} for p in periods]


def remaining(facts, kinds=None):
    return count(facts, lambda f: (kinds is None or f["kind"] in kinds) and f["category"] in OPEN)


def item_table(facts, start):
    rows = [f for f in facts if f["category"] in OPEN or (f["done"] and (start is None or f["done"] >= start)) or (f["canceledAt"] and (start is None or f["canceledAt"] >= start))]
    return [{"key": f["key"], "title": f["title"], "url": f["url"], "type": f["type"], "kind": f["kind"], "state": f["state"], "category": f["category"],
             "created": f["created"].date().isoformat(), "done": f["done"].date().isoformat() if f["done"] else "", "reopened": f["reopened"],
             "hoursCycle": f["hoursCycle"], "ageDays": f["ageDays"]} for f in sorted(rows, key=lambda r: r["created"])]


def completion_share(facts, start):
    done = [f for f in facts if f["done"] and (start is None or f["done"] >= start)]
    return share(count(done, lambda f: f["kind"] == "bug"), len(done))
