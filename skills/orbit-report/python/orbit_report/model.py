"""The standard report's MODEL: every number the standard sections draw, built
from pull-request facts taken at the cut-off (prs.py) and the periods the
report compares (periods.py).

Honest by construction:
  * a PR counts toward throughput in the period it was MERGED, whenever it was
    opened; opened, closed and open-at-end are counted separately
  * "open at the end" of a period is read at the earlier of the period's end
    and the cut-off
  * an empty set summarises to None (a dash on the page), never to 0
  * review numbers are ACTIVITY, labelled so -- what they cannot say about
    review quality or anyone's productivity the report says in words
"""
from collections import Counter, defaultdict

from .classify import WORK_TYPES
from .periods import within
from .stats import count, med, mean, pct, share, total

SIZES = ["XS", "S", "M", "L", "XL"]
CYCLE_BINS = [("< 1h", 0, 1), ("1–4h", 1, 4), ("4–24h", 4, 24), ("1–3d", 24, 72), ("3–7d", 72, 168), ("1–2w", 168, 336), ("> 2w", 336, 1e12)]


def share_of(merged, work_type):
    return share(count(merged, lambda f: f["workType"] == work_type), len(merged))


def xl_share(merged):
    known = [f for f in merged if f["sizeBucket"] != "unknown"]
    return share(count(known, lambda f: f["sizeBucket"] == "XL"), len(known))


def merged_in(facts, period):
    return [f for f in facts if f["state"] == "merged" and within(f["merged"], period)]


def open_at(facts, moment):
    return [f for f in facts if f["created"] < moment and (f["endedAt"] is None or f["endedAt"] >= moment)]


def period_row(p, facts, cutoff, ai_heavy):
    merged = merged_in(facts, p)
    edge = min(p["end"], cutoff)
    lines = total(f["linesChanged"] for f in merged)
    commits = sum(f["commits"] for f in merged)
    types = Counter(f["workType"] for f in merged)
    return {"label": p["label"], "start": p["start"].isoformat(), "end": p["end"].isoformat(), "fromDate": p.get("fromDate"), "toDate": p.get("toDate"), "partial": p["partial"],
            "prsMerged": len(merged), "prsOpened": count(facts, lambda f: within(f["created"], p)),
            "prsClosedUnmerged": count(facts, lambda f: f["state"] == "closed" and within(f["endedAt"], p)),
            "wipAtEnd": len(open_at(facts, edge)), "additions": total(f["additions"] for f in merged), "deletions": total(f["deletions"] for f in merged),
            "linesChanged": lines, "filesChanged": total(f["changedFiles"] for f in merged), "commits": commits,
            "aiCommits": sum(f["aiCommits"] for f in merged), "aiCommitSharePct": share(sum(f["aiCommits"] for f in merged), commits),
            **flow_of(merged), **review_of(merged, lines), "workTypes": {t: types.get(t, 0) for t in WORK_TYPES},
            "fixSharePct": share(types.get("fix", 0), len(merged)), "areaLoc": area_loc(merged),
            "sizeBuckets": dict(Counter(f["sizeBucket"] for f in merged)),
            "activeContributorCount": len({f["author"] for f in merged} | {r for f in merged for r in f["humanReviewers"]}),
            "aiHeavyPrs": count(merged, lambda f: (f["aiShare"] or 0) >= ai_heavy), "aiHeavyPct": share(count(merged, lambda f: (f["aiShare"] or 0) >= ai_heavy), len(merged))}


def flow_of(merged):
    cycles = [f["hoursCycle"] for f in merged]
    return {"medianPrSize": med([f["linesChanged"] for f in merged]), "medianCycleTimeH": med(cycles), "p85CycleTimeH": pct(cycles).get("p85"),
            "medianLeadTimeH": med([f["hoursLead"] for f in merged]), "medianPickupH": med([f["hoursPickup"] for f in merged]),
            "medianApprovalToMergeH": med([f["hoursApprovalToMerge"] for f in merged])}


def review_of(merged, lines):
    comments = sum(f["reviewComments"] for f in merged)
    return {"humanReviews": sum(f["humanReviews"] for f in merged), "botReviews": sum(f["botReviews"] for f in merged),
            "humanReviewsPerPr": round(sum(f["humanReviews"] for f in merged) / len(merged), 2) if merged else None,
            "reviewCoveragePct": share(count(merged, lambda f: f["humanReviews"] > 0), len(merged)),
            "approvedBeforeMergePct": share(count(merged, lambda f: f["approvals"] > 0), len(merged)),
            "reviewComments": comments, "reviewCommentsPer100Loc": round(comments / lines * 100, 2) if lines else None,
            "unresolvedAtCapturePct": share(count(merged, lambda f: f["unresolvedAtCapture"] > 0), len(merged)),
            "changesRequested": sum(f["changesRequested"] for f in merged), "selfMerged": count(merged, lambda f: f["selfMerged"]),
            "forcePushes": sum(f["events"].get("force-push", 0) for f in merged), "reworkCommits": sum(f["reworkCommits"] for f in merged)}


def area_loc(merged):
    areas = Counter()
    for f in merged:
        areas.update(f["areaLoc"])
    return dict(areas)


def daily_wip(facts, calendar, cutoff):
    days = []
    for index, date in enumerate(calendar.dates):
        moment = min(calendar.day_end(index), cutoff)
        days.append({"date": date, "wip": len(open_at(facts, moment))})
    return days


def flow_summary(facts, merged, weeks):
    fixes = [f for f in merged if f["workType"] == "fix"]
    ended = [f for f in facts if f["state"] in ("merged", "closed")]
    return {"leadTimeH": pct([f["hoursLead"] for f in merged]), "cycleTimeH": pct([f["hoursCycle"] for f in merged]),
            "codingTimeH": pct([f["hoursCoding"] for f in merged]), "pickupTimeH": pct([f["hoursPickup"] for f in merged]),
            "reviewTimeH": pct([f["hoursReview"] for f in merged]), "approvalToMergeH": pct([f["hoursApprovalToMerge"] for f in merged]),
            "mergesPerWeek": round(len(merged) / weeks, 2) if weeks else None, "fixPrs": len(fixes), "fixSharePct": share(len(fixes), len(merged)),
            "fixMedianCycleH": med([f["hoursCycle"] for f in fixes]), "fixP85CycleH": pct([f["hoursCycle"] for f in fixes]).get("p85"),
            "fixMedianSize": med([f["linesChanged"] for f in fixes]), "closedUnmergedPct": share(count(ended, lambda f: f["state"] == "closed"), len(ended)),
            "postMergeReviews": sum(f["postMergeReviews"] for f in merged), "unclassifiedPct": share(count(merged, lambda f: f["workType"] == "unclassified"), len(merged))}


def sizes(merged):
    by = {b: [f for f in merged if f["sizeBucket"] == b] for b in SIZES}
    vs = {b: {"prs": len(rows), "medianCycleH": med([f["hoursCycle"] for f in rows]), "medianReviewComments": med([f["reviewComments"] for f in rows]),
              "humanReviewCoveragePct": share(count(rows, lambda f: f["humanReviews"] > 0), len(rows)),
              "changesRequestedPct": share(count(rows, lambda f: f["changesRequested"] > 0), len(rows))} for b, rows in by.items()}
    cycle = {label: count(merged, lambda f: f["hoursCycle"] is not None and lo <= f["hoursCycle"] < hi) for label, lo, hi in CYCLE_BINS}
    return {"hist": {b: len(rows) for b, rows in by.items()}, "unknownSize": count(merged, lambda f: f["sizeBucket"] == "unknown"), "cycleHist": cycle, "sizeVs": vs}


def review_summary(facts, merged):
    comments = sum(f["reviewComments"] for f in merged)
    return {"humanReviewCoveragePct": share(count(merged, lambda f: f["humanReviews"] > 0), len(merged)),
            "botReviewCoveragePct": share(count(merged, lambda f: f["botReviews"] > 0), len(merged)),
            "approvedPct": share(count(merged, lambda f: f["approvals"] > 0), len(merged)),
            "changesRequestedPrsPct": share(count(merged, lambda f: f["changesRequested"] > 0), len(merged)),
            "selfMergedPct": share(count(merged, lambda f: f["selfMerged"]), len(merged)),
            "unresolvedAtCapturePct": share(count(merged, lambda f: f["unresolvedAtCapture"] > 0), len(merged)),
            "humanReviewsPerPr": mean([f["humanReviews"] for f in merged]), "reviewCommentsPerPr": mean([f["reviewComments"] for f in merged]),
            "reviewCommentsByBotsPct": share(sum(f["reviewCommentsByBots"] for f in merged), comments),
            "reworkPrsPct": share(count(merged, lambda f: f["reworkCommits"] > 0), len(merged)),
            "multipleHumanReviewers": count(merged, lambda f: len(f["humanReviewers"]) >= 2),
            "postMergeReviews": sum(f["postMergeReviews"] for f in merged)}


def collaboration(merged, facts, areas_config):
    matrix = defaultdict(Counter)
    for f in merged:
        for reviewer in f["humanReviewers"]:
            matrix[f["author"]][reviewer] += 1
    return {"reviewMatrix": {a: dict(c) for a, c in matrix.items()}, "authors": sorted({f["author"] for f in merged if not f["authorIsBot"]}),
            "areas": bus_factor(merged)}


def bus_factor(merged):
    by_area = defaultdict(Counter)
    for f in merged:
        for area, lines in f["areaLoc"].items():
            by_area[area][f["author"]] += lines
    rows = [area_row(area, c, merged) for area, c in by_area.items() if sum(c.values())]
    return sorted(rows, key=lambda r: -r["linesChanged"])


def area_row(area, lines_by_author, merged):
    total, ranked = sum(lines_by_author.values()), lines_by_author.most_common()
    covered, needed = 0, 0
    for _, lines in ranked:
        covered, needed = covered + lines, needed + 1
        if covered / total >= 0.5:
            break
    return {"area": area, "linesChanged": total, "prs": count(merged, lambda f: area in f["areaLoc"]), "authors": len(ranked),
            "busFactor50": needed, "topAuthorSharePct": share(ranked[0][1], total), "shares": {a: share(v, total) for a, v in ranked}}


def contributors(facts, merged):
    people = sorted({f["author"] for f in facts if not f["authorIsBot"]})
    return sorted((contributor(p, facts, merged) for p in people), key=lambda r: -r["merged"])


def contributor(login, facts, merged):
    mine = [f for f in merged if f["author"] == login]
    return {"login": login, "merged": len(mine), "open": count(facts, lambda f: f["author"] == login and f["state"] == "open"),
            "linesChanged": total(f["linesChanged"] for f in mine), "medianPrSize": med([f["linesChanged"] for f in mine]),
            "commits": sum(f["commits"] for f in mine), "aiCommitSharePct": share(sum(f["aiCommits"] for f in mine), sum(f["commits"] for f in mine)),
            "medianCycleTimeH": med([f["hoursCycle"] for f in mine]), "reviewsGiven": sum(1 for f in merged for r in f["humanReviewers"] if r == login),
            "reviewsReceived": sum(f["humanReviews"] for f in mine), "selfMerged": count(mine, lambda f: f["selfMerged"]),
            "primaryAreas": dict(Counter(f["primaryArea"] for f in mine).most_common(3))}


def ai_summary(merged, ai_heavy):
    heavy = [f for f in merged if (f["aiShare"] or 0) >= ai_heavy]
    light = [f for f in merged if (f["aiShare"] or 0) < ai_heavy]
    commits = sum(f["commits"] for f in merged)
    return {"threshold": ai_heavy, "aiCommitSharePct": share(sum(f["aiCommits"] for f in merged), commits),
            "aiHeavyPrsPct": share(len(heavy), len(merged)), "aiHeavy": group(heavy), "humanLed": group(light), "all": group(merged),
            "botReviewSharePct": share(sum(f["botReviews"] for f in merged), sum(f["botReviews"] + f["humanReviews"] for f in merged))}


def group(rows):
    return {"prs": len(rows), "medianSize": med([f["linesChanged"] for f in rows]), "medianFiles": med([f["changedFiles"] for f in rows]),
            "medianCommits": med([f["commits"] for f in rows]), "medianCycleTimeH": med([f["hoursCycle"] for f in rows]),
            "medianLeadTimeH": med([f["hoursLead"] for f in rows]), "medianPickupH": med([f["hoursPickup"] for f in rows]),
            "humanReviewCoveragePct": share(count(rows, lambda f: f["humanReviews"] > 0), len(rows)),
            "changesRequestedPct": share(count(rows, lambda f: f["changesRequested"] > 0), len(rows)),
            "reworkPrsPct": share(count(rows, lambda f: f["reworkCommits"] > 0), len(rows)),
            "fixSharePct": share(count(rows, lambda f: f["workType"] == "fix"), len(rows)),
            "xlSharePct": xl_share(rows)}


def open_prs(facts, cutoff):
    rows = sorted(open_at(facts, cutoff), key=lambda f: f["created"])
    return [{"id": f["id"], "repo": f["repo"], "number": f["number"], "title": f["title"], "url": f["url"], "author": f["author"],
             "createdAt": f["createdAt"], "ageDays": f["ageDaysAtCutoff"], "draft": f["draft"], "workType": f["workType"],
             "linesChanged": f["linesChanged"], "humanReviews": f["humanReviews"], "approvals": f["approvals"],
             "unresolvedAtCapture": f["unresolvedAtCapture"]} for f in rows]


def pr_table(facts, sdk):
    rows = [f for f in facts if f["state"] == "open" or sdk.in_window(f["createdAt"]) or (f["merged"] and sdk.in_window(f["mergedAt"])) or (f["endedAt"] and sdk.in_window(f["endedAt"].isoformat()))]
    return [{"id": f["id"], "repo": f["repo"], "number": f["number"], "title": f["title"], "url": f["url"], "state": f["state"], "author": f["author"],
             "workType": f["workType"], "primaryArea": f["primaryArea"], "sizeBucket": f["sizeBucket"], "linesChanged": f["linesChanged"],
             "changedFiles": f["changedFiles"], "commits": f["commits"], "aiCommits": f["aiCommits"], "humanReviews": f["humanReviews"],
             "botReviews": f["botReviews"], "reviewComments": f["reviewComments"], "unresolvedAtCapture": f["unresolvedAtCapture"],
             "changesRequested": f["changesRequested"], "hoursPickup": f["hoursPickup"], "hoursCycle": f["hoursCycle"], "hoursLead": f["hoursLead"],
             "created": (f["createdAt"] or "")[:10], "merged": (f["mergedAt"] or "")[:10], "truncated": f["truncated"]} for f in sorted(rows, key=lambda r: (r["repo"] or "", r["number"] or 0))]
