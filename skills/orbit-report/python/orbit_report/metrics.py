"""The STANDARD metrics part (orbit.report.metrics): the model every standard
section draws, and the headline KPIs as declared metrics.

It reads only the frozen snapshot. A collection the source could not give is a
section that says why -- `unavailable (needs X)` or `not-configured` -- and
never a row of zeros; the rest of the report is built as usual.
"""
from . import documents, model, pipelines, workitems
from .classify import People
from .periods import months_of, periods_of
from .prs import facts
from .sdk import UNUSABLE
from .stats import total

AI_HEAVY = 0.5
FORECAST_KINDS = ("requirement", "bug", "issue", "feature")


def run(envelope, sdk):
    mapping = sdk.settings.get("mapping") or {}
    people = People(mapping)
    grain, periods = periods_of(sdk, rows(sdk, "iterations"), mapping.get("iterations"))
    built = assemble(sdk, people, mapping, grain, periods)
    sdk.write("model.json", built)
    record(sdk, built)
    return {"notes": built["notes"]}


def rows(sdk, name):
    return sdk.collection(name) if sdk.has(name) else []


def status_of(sdk, name):
    state = sdk.completeness(name)
    return {"status": state.get("status"), "reason": state.get("reason")} if state.get("status") in UNUSABLE else {"status": "ok"}


def assemble(sdk, people, mapping, grain, periods):
    ai_heavy = float(mapping.get("aiHeavyThreshold", AI_HEAVY))
    prs = [f for f in (facts(pr, sdk.cutoff, people, mapping.get("areas")) for pr in rows(sdk, "pullRequests")) if f]
    items = [f for f in (workitems.item_facts(i, sdk.cutoff, sdk.start) for i in rows(sdk, "workItems")) if f]
    builds = pipelines.builds_facts(rows(sdk, "builds"), sdk.cutoff)
    shipped = pipelines.deployments_facts(rows(sdk, "deployments"), sdk.cutoff)
    return shaped(sdk, grain, periods, prs, items, builds, shipped, ai_heavy)


def shaped(sdk, grain, periods, prs, items, builds, shipped, ai_heavy):
    merged = [f for f in prs if f["state"] == "merged" and sdk.in_window(f["mergedAt"])]
    weeks = window_weeks(sdk)
    docs = documents.rollup(sdk.collection("documents")) if sdk.has("documents") and sdk.collection("documents") else None
    return {"contract": "orbit.report.model/v1", "grain": grain, "sections": availability(sdk, prs, items, builds, docs),
            "periods": [period(p, prs, items, builds, shipped, sdk, ai_heavy) for p in periods],
            "months": [period(m, prs, items, builds, shipped, sdk, ai_heavy) for m in months_of(sdk)],
            "daily": model.daily_wip(prs, sdk.calendar, sdk.cutoff), "flow": model.flow_summary(prs, merged, weeks), "size": model.sizes(merged),
            "review": model.review_summary(prs, merged), "collaboration": model.collaboration(merged, prs, None),
            "contributors": model.contributors(prs, merged), "ai": model.ai_summary(merged, ai_heavy),
            "backlog": {"openPrs": model.open_prs(prs, sdk.cutoff), "workItems": workitems.summary(items, sdk.start, rows(sdk, "workItemTypes")) if items else None, "documents": docs},
            "pipelines": pipelines.summary(builds, shipped, weeks) if (builds or shipped) else None,
            "throughput": throughput(periods, items, merged, docs), "prTable": model.pr_table(prs, sdk), "itemTable": workitems.item_table(items, sdk.start),
            "kpis": kpis(prs, merged, items, builds, shipped, weeks, sdk), "notes": notes(sdk, prs, items)}


def period(p, prs, items, builds, shipped, sdk, ai_heavy):
    row = model.period_row(p, prs, sdk.cutoff, ai_heavy)
    return {**row, **workitems.period_items(p, items), **pipelines.period_builds(p, builds, shipped)}


def window_weeks(sdk):
    start = sdk.start or sdk.calendar.starts[0]
    return max((sdk.end - start).total_seconds() / (7 * 86400), 0) or None


def availability(sdk, prs, items, builds, docs):
    return {"pullRequests": status_of(sdk, "pullRequests"), "workItems": status_of(sdk, "workItems"), "builds": status_of(sdk, "builds"),
            "deployments": status_of(sdk, "deployments"), "iterations": status_of(sdk, "iterations"), "documents": status_of(sdk, "documents")}


def throughput(periods, items, merged, docs):
    """The series a forecast may sample, what it would be sampled for, and how
    long one period is -- so a forecast in iterations is dated in iterations."""
    days = period_days(periods)
    if items:
        return {"unit": "work items completed", "source": "workItems", "series": workitems.throughput(periods, items, FORECAST_KINDS), "remaining": workitems.remaining(items, FORECAST_KINDS), "periodDays": days}
    if docs:
        series = [{"label": p["label"], "partial": p["partial"], "completed": sum(1 for f in merged if f["workType"] == "feat" and p["start"] <= f["merged"] < p["end"])} for p in periods]
        return {"unit": "feature pull requests merged", "source": "pullRequests", "series": series, "remaining": documents.remaining_stories(docs), "remainingUnit": "stories", "periodDays": days}
    return None


def period_days(periods):
    full = sorted((p["end"] - p["start"]).total_seconds() / 86400 for p in periods if not p["partial"])
    return round(full[len(full) // 2], 1) if full else 7


def kpis(prs, merged, items, builds, shipped, weeks, sdk):
    flow = model.flow_of(merged)
    review = model.review_of(merged, total(f["linesChanged"] for f in merged))
    done = [f for f in items if f["done"] and (sdk.start is None or f["done"] >= sdk.start)]
    return {"prsMerged": len(merged), "mergesPerWeek": round(len(merged) / weeks, 2) if weeks else None, **flow, "reviewCoveragePct": review["reviewCoveragePct"],
            "approvedBeforeMergePct": review["approvedBeforeMergePct"], "unresolvedAtCapturePct": review["unresolvedAtCapturePct"],
            "fixSharePct": model.share_of(merged, "fix"), "aiCommitSharePct": model.ai_summary(merged, AI_HEAVY)["aiCommitSharePct"],
            "xlSharePct": model.xl_share(merged), "openPrsAtCutoff": len(model.open_at(prs, sdk.cutoff)),
            "itemsCompleted": len(done) if items else None, "itemsPerWeek": round(len(done) / weeks, 2) if items and weeks else None,
            "itemCycleTimeMedianH": workitems.summary(items, sdk.start, [])["cycleTimeH"].get("p50") if items else None,
            "backlogAtCutoff": workitems.remaining(items) if items else None,
            "deploymentsPerWeek": round(sum(1 for d in shipped if d["outcome"] == "success" and sdk.in_window(d["finished"].isoformat())) / weeks, 2) if shipped and weeks else None,
            "buildSuccessPct": pipelines.summary(builds, [], weeks)["buildSuccessPct"] if builds else None}


def notes(sdk, prs, items):
    said = []
    truncated = sorted({t for f in prs for t in f["truncated"]})
    if truncated:
        said.append(f"Some pull requests had more {', '.join(truncated)} than the source returns in one query; those counts are floors.")
    if items and any(not f["pointInTime"] for f in items):
        said.append("Some work items could not be read as they were at the cut-off; their current state was used and they are marked.")
    if prs and all(f["sizeBucket"] == "unknown" for f in prs):
        said.append("This source does not report lines changed per pull request, so pull request size, XL share and code ownership by area are not shown.")
    return said


KPI_METRICS = [
    ("orbit.report.kpi.prs-merged", "prsMerged"), ("orbit.report.kpi.merges-per-week", "mergesPerWeek"),
    ("orbit.report.kpi.cycle-time-median", "medianCycleTimeH"), ("orbit.report.kpi.cycle-time-p85", "p85CycleTimeH"),
    ("orbit.report.kpi.lead-time-median", "medianLeadTimeH"), ("orbit.report.kpi.pickup-median", "medianPickupH"),
    ("orbit.report.kpi.pr-size-median", "medianPrSize"), ("orbit.report.kpi.xl-share", "xlSharePct"),
    ("orbit.report.kpi.review-coverage", "reviewCoveragePct"), ("orbit.report.kpi.approved-before-merge", "approvedBeforeMergePct"),
    ("orbit.report.kpi.unresolved-at-capture", "unresolvedAtCapturePct"), ("orbit.report.kpi.fix-share", "fixSharePct"),
    ("orbit.report.kpi.ai-commit-share", "aiCommitSharePct"), ("orbit.report.kpi.open-prs-at-cutoff", "openPrsAtCutoff"),
    ("orbit.report.kpi.items-completed", "itemsCompleted"), ("orbit.report.kpi.items-per-week", "itemsPerWeek"),
    ("orbit.report.kpi.item-cycle-time-median", "itemCycleTimeMedianH"), ("orbit.report.kpi.backlog-at-cutoff", "backlogAtCutoff"),
    ("orbit.report.kpi.deployments-per-week", "deploymentsPerWeek"), ("orbit.report.kpi.build-success", "buildSuccessPct"),
]


def record(sdk, built):
    for metric_id, key in KPI_METRICS:
        value = built["kpis"].get(key)
        sdk.metric(metric_id, value=value, basis={"window": [sdk.window.get("from"), sdk.window.get("to")], "cutoff": sdk.window.get("cutoff")},
                   missing=[] if value is not None else ["no data in this window for it"])
