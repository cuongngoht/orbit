"""The periods a report compares: the source's own iterations when it has
them, else calendar weeks -- never an invented sprint length.

The kit this came from cut the whole history into two-week "sprints" starting
on the Monday of the first PR, ignored the `sprintDays` its own config wrote,
and named nothing in the repository that marked a real boundary. Here:

  iteration   the source's iterations (Azure Boards team iterations, a GitHub
              Projects iteration field) that overlap the window, at least two
  cadence     a cadence the project configured (`mapping.iterations`: start +
              days) -- the old `sprintStart` + `sprintDays`, applied for real
  week        otherwise, the calendar's ISO weeks

A period cut by the window's edge is marked `partial`, and nothing that samples
periods (the forecast) may treat it as a whole one.
"""
from datetime import date, timedelta

from .timecal import instant


def periods_of(sdk, iterations, cadence=None):
    grain, rows = chosen(sdk, iterations, cadence)
    return grain, dated(sdk, rows)


def chosen(sdk, iterations, cadence):
    start, end = window_edges(sdk)
    sourced = [p for p in (from_iteration(i, start, end) for i in iterations or []) if p]
    if len(sourced) >= 2:
        return "iteration", sourced
    if cadence and cadence.get("start") and cadence.get("days"):
        return "cadence", cadence_periods(sdk, cadence, start, end)
    return "week", [bounded(label, a, b, start, end, 7) for label, a, b in sdk.calendar.buckets("week")]


# Each period's first and last LOCAL day, for a reader -- the instants stay
# the truth every count is made from.
def dated(sdk, rows):
    for p in rows:
        p["fromDate"] = sdk.calendar.local_date(p["start"])
        p["toDate"] = sdk.calendar.local_date(p["end"] - timedelta(seconds=1))
    return rows


def window_edges(sdk):
    return (sdk.start or sdk.calendar.starts[0]), sdk.end


def from_iteration(it, start, end):
    a, b = instant(it.get("startUtc")), instant(it.get("endUtc"))
    if not a or not b or b <= start or a >= end:
        return None
    return {"label": it.get("name") or it.get("id"), "start": max(a, start), "end": min(b, end), "partial": a < start or b > end, "source": "iteration"}


# A period starts at the LOCAL midnight of every `days`-th day from `start`,
# read off the calendar, so a cadence obeys the project's zone like a week does.
# The head of the window before the first boundary is a partial period.
def cadence_periods(sdk, cadence, start, end):
    first, days = date.fromisoformat(cadence["start"]), int(cadence["days"])
    offset = lambda d: (date.fromisoformat(d) - first).days
    marks = [(at, offset(d) // days + 1) for d, at in zip(sdk.calendar.dates, sdk.calendar.starts) if offset(d) % days == 0]
    if not marks or marks[0][0] > start:
        marks.insert(0, (start, marks[0][1] - 1 if marks else 1))
    bounds = marks + [(end, None)]
    return [bounded(f"P{n:02d}", a, b, start, end, days) for (a, n), (b, _) in zip(bounds, bounds[1:]) if b > a]


def bounded(label, a, b, start, end, full_days):
    lo, hi = max(a, start), min(b, end)
    return {"label": label, "start": lo, "end": hi, "partial": (hi - lo) < timedelta(days=full_days) - timedelta(hours=2), "source": "calendar"}


def months_of(sdk):
    start, end = window_edges(sdk)
    return dated(sdk, [{"label": label, "start": max(a, start), "end": min(b, end), "partial": a < start or b > end} for label, a, b in sdk.calendar.buckets("month")])


def within(moment, period):
    return moment is not None and period["start"] <= moment < period["end"]
