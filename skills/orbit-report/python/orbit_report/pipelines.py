"""Builds and deployments -- only when the source HAS them.

A section with no data is not drawn as zeros: if the collector could not read
pipelines (no permission, not configured), the model says so and the page shows
the reason. Deployment frequency comes only from real deployment records; a
merge to the default branch is a proxy, and the flow section already labels it.
"""
from collections import Counter, defaultdict

from .periods import within
from .stats import count, med, share
from .timecal import hours, instant

RESULTS = {"succeeded": "success", "success": "success", "failed": "failure", "failure": "failure", "canceled": "canceled",
           "cancelled": "canceled", "partiallysucceeded": "partial", "timed_out": "failure", "action_required": "other", "skipped": "other"}


def result_of(build):
    return RESULTS.get(str(build.get("result") or build.get("status") or "").lower(), "other")


def builds_facts(builds, cutoff):
    rows = []
    for b in builds or []:
        finished = instant(b.get("finishedAt"))
        if finished and finished < cutoff:
            rows.append({**b, "finished": finished, "outcome": result_of(b), "hours": hours(instant(b.get("startedAt")), finished)})
    return rows


def period_builds(p, builds, deployments):
    mine = [b for b in builds if within(b["finished"], p)]
    shipped = [d for d in deployments if within(d["finished"], p)]
    return {"builds": len(mine), "buildSuccessPct": share(count(mine, lambda b: b["outcome"] == "success"), count(mine, lambda b: b["outcome"] in ("success", "failure", "partial"))),
            "deployments": count(shipped, lambda d: d["outcome"] == "success")}


def deployments_facts(deployments, cutoff):
    rows = []
    for d in deployments or []:
        finished = instant(d.get("finishedAt") or d.get("createdAt"))
        if finished and finished < cutoff:
            rows.append({**d, "finished": finished, "outcome": result_of({"result": d.get("status")})})
    return rows


def summary(builds, deployments, weeks):
    by_pipeline = defaultdict(list)
    for b in builds:
        by_pipeline[b.get("pipeline") or "(unnamed)"].append(b)
    environments = Counter(d.get("environment") or "(unnamed)" for d in deployments if d["outcome"] == "success")
    return {"builds": len(builds), "buildSuccessPct": share(count(builds, lambda b: b["outcome"] == "success"), count(builds, lambda b: b["outcome"] in ("success", "failure", "partial"))),
            "medianBuildHours": med([b["hours"] for b in builds]), "pipelines": [pipeline_row(n, rows) for n, rows in sorted(by_pipeline.items())],
            "deployments": count(deployments, lambda d: d["outcome"] == "success"), "deploymentsPerWeek": round(count(deployments, lambda d: d["outcome"] == "success") / weeks, 2) if weeks else None,
            "environments": dict(environments.most_common())}


def pipeline_row(name, rows):
    return {"pipeline": name, "runs": len(rows), "successPct": share(count(rows, lambda b: b["outcome"] == "success"), count(rows, lambda b: b["outcome"] in ("success", "failure", "partial"))),
            "failed": count(rows, lambda b: b["outcome"] == "failure"), "medianHours": med([b["hours"] for b in rows])}
