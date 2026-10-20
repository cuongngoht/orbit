"""Time for a report part, from the calendar the engine handed it.

The engine decides once, in the project's time zone, where every local day,
week and month begins, and hands those instants over. A part never needs a
time-zone database: which day an instant falls on is a binary search over the
day starts. So the same snapshot gives the same answer on every machine, and on
Windows, where Python's zoneinfo would need a tzdata package.
"""
from bisect import bisect_right
from datetime import datetime, timezone


def instant(text):
    """An ISO-8601 timestamp as an aware UTC datetime, or None."""
    if not text:
        return None
    return datetime.fromisoformat(text).astimezone(timezone.utc)


def iso(moment):
    return moment.astimezone(timezone.utc).isoformat().replace("+00:00", "Z") if moment else None


def hours(start, end):
    """Elapsed calendar hours between two instants, or None when either is missing."""
    return round((end - start).total_seconds() / 3600, 2) if start and end else None


class Calendar:
    def __init__(self, table):
        self.tz = table["tz"]
        self.dates = [day for day, _ in table["days"]]
        self.starts = [instant(start) for _, start in table["days"]]
        self.end = instant(table["end"])
        self.weeks = [dict(w, startAt=instant(w["startUtc"])) for w in table.get("weeks", [])]
        self.months = [dict(m, startAt=instant(m["startUtc"])) for m in table.get("months", [])]

    def local_date(self, moment):
        """The local day `moment` falls on, or None outside the calendar."""
        index = self.index_of(moment)
        return self.dates[index] if index is not None else None

    def index_of(self, moment):
        if moment is None or not self.starts or moment < self.starts[0] or moment >= self.end:
            return None
        return bisect_right(self.starts, moment) - 1

    def day_end(self, index):
        """The instant the day at `index` ends (the next day's start)."""
        return self.starts[index + 1] if index + 1 < len(self.starts) else self.end

    def buckets(self, grain):
        """[(label, start, end)] for 'week' or 'month' -- each bounded by the calendar."""
        rows = self.weeks if grain == "week" else self.months
        starts = [r["startAt"] for r in rows] + [self.end]
        return [(label_of(r, grain), starts[i], starts[i + 1]) for i, r in enumerate(rows)]


def label_of(row, grain):
    return row["month"] if grain == "month" else row["start"]
