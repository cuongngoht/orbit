"""Open pull request AGING at the cut-off: for every pull request still open when
the window closed, how long it had been waiting -- bucketed, with the median, and
the longest-waiting ones named with a link.

Made for: a product owner asking how long the pull requests still open at the
cut-off had been waiting. Reads only the snapshot's pull requests; a pull request
is open at the cut-off when it was created before it and neither merged nor
closed before it -- its own close and reopen events decide, so one closed in
July and reopened in September was closed on 31 August. Nothing after the
cut-off is read, and nothing is estimated: an age is the cut-off minus the day
the pull request was opened.
"""
from datetime import datetime
from statistics import median

BUCKETS = [("under 1 day", 0, 1), ("1-3 days", 1, 3), ("3-7 days", 3, 7), ("1-2 weeks", 7, 14), ("2-4 weeks", 14, 28), ("over 4 weeks", 28, None)]
LONGEST = 10


def moment(text):
    return datetime.fromisoformat(text) if text else None


def open_at(pr, cutoff):
    created = moment(pr.get("createdAt"))
    if created is None or created >= cutoff:
        return False
    ends = [moment(t) for t in (pr.get("mergedAt"), pr.get("closedAt")) if t]
    events = sorted((moment(e["at"]), e["type"]) for e in pr.get("events") or [] if e.get("at") and moment(e["at"]) < cutoff)
    last = next((kind for _, kind in reversed(events) if kind in ("closed", "reopened", "merged")), None)
    if last is not None:
        return last == "reopened"
    return not any(end < cutoff for end in ends)


def bucket(days):
    return next(label for label, low, high in BUCKETS if days >= low and (high is None or days < high))


def run(envelope, sdk):
    cutoff = sdk.cutoff
    waiting = [(round((cutoff - moment(p["createdAt"])).total_seconds() / 86400, 1), p) for p in sdk.collection("pullRequests") if open_at(p, cutoff)]
    ages = [days for days, _ in waiting]
    counts = [sum(1 for d in ages if bucket(d) == label) for label, _, _ in BUCKETS]
    sdk.metric("pr-aging.open-at-cutoff", value=len(waiting), basis={"samples": len(waiting)})
    sdk.metric("pr-aging.median-age", value=round(median(ages), 1) if ages else None, basis={"samples": len(ages)}, missing=[] if ages else ["no pull request was open at the cut-off"])
    sdk.metric("pr-aging.over-two-weeks", value=round(100 * sum(1 for d in ages if d >= 14) / len(ages), 1) if ages else None, basis={"samples": len(ages)})
    longest = sorted(waiting, key=lambda w: -w[0])[:LONGEST]
    rows = [[{"url": p.get("url"), "text": f"{p.get('repo')}#{p.get('number')}"}, p.get("title") or "", days, (p.get("author") or {}).get("login") or "", "draft" if p.get("draft") else ""] for days, p in longest]
    sdk.section([
        sdk.tiles([sdk.tile("Open at the cut-off", len(waiting), "pull requests"), sdk.tile("Median age", round(median(ages), 1) if ages else "–", "days"), sdk.tile("Waiting two weeks or more", sum(1 for d in ages if d >= 14), "pull requests")]),
        sdk.chart("bar", [label for label, _, _ in BUCKETS], [{"name": "open pull requests", "values": counts}], title="How long they had been open at the cut-off", unit="pull requests"),
        sdk.table(["Pull request", "Title", "Age (days)", "Author", ""], rows, title=f"The {len(rows)} longest waiting"),
        sdk.notes(["Age is the cut-off minus the moment the pull request was opened; time as a draft counts.", "Open means not merged and not closed at the cut-off, read from the pull request's own events."]),
    ], title="Open PR aging")
    return {}
