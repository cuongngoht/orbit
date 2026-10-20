"""One pull request, as it stood at the CUT-OFF.

A report about the past must not know the future, so nothing here reads a PR's
current state: whether it was merged, closed or still open is rebuilt from its
own timestamps and its close/reopen events before the cut-off, and a review,
comment, commit or push after the cut-off simply did not happen yet.

Three corrections to the kit this came from, each a line in its README:

  * only reviews submitted BEFORE the merge count toward review before merge --
    a review left afterwards is counted, separately, as post-merge;
  * a thread's resolution is only known as it is NOW (the source keeps no
    history of it), so it is "unresolved at capture", never "at merge";
  * what cannot be classified is `unclassified`, never a feature.
"""
from collections import Counter

from .classify import area_of, size_bucket, work_type
from .timecal import hours, instant, iso

CLOSING = {"closed": "closed", "reopened": "open"}


def facts(pr, cutoff, people, areas=None):
    """The PR at the cut-off, or None if it did not exist yet."""
    created = instant(pr.get("createdAt"))
    if created is None or created >= cutoff:
        return None
    state, merged_at, closed_at = state_at(pr, created, cutoff)
    ended = merged_at or closed_at
    commits = [c for c in pr.get("commits") or [] if before(c.get("committedAt"), cutoff)]
    return {**identity(pr, people), **size(pr, areas), **timing(pr, created, merged_at, closed_at, commits, cutoff),
            **reviewing(pr, merged_at or cutoff, cutoff, commits, people), **authored(commits, people, pr),
            "state": state, "createdAt": pr.get("createdAt"), "mergedAt": iso(merged_at), "closedAt": iso(closed_at),
            "endedAt": ended, "created": created, "merged": merged_at,
            "events": Counter(e.get("type") for e in pr.get("events") or [] if before(e.get("at"), cutoff)),
            "truncated": list(pr.get("truncated") or [])}


def before(text, cutoff):
    moment = instant(text)
    return moment is not None and moment < cutoff


def state_at(pr, created, cutoff):
    merged = instant(pr.get("mergedAt"))
    if merged and merged < cutoff:
        return "merged", merged, None
    turns = sorted((instant(e["at"]), CLOSING[e["type"]]) for e in pr.get("events") or [] if e.get("type") in CLOSING and before(e.get("at"), cutoff))
    if turns:
        return (turns[-1][1], None, turns[-1][0] if turns[-1][1] == "closed" else None)
    closed = instant(pr.get("closedAt"))
    return ("closed", None, closed) if closed and closed < cutoff and pr.get("state") == "closed" else ("open", None, None)


def identity(pr, people):
    author = pr.get("author") or {}
    return {"id": pr["id"], "repo": pr.get("repo"), "number": pr.get("number"), "url": pr.get("url"), "title": pr.get("title") or "",
            "author": author.get("login") or "(unknown)", "authorIsBot": people.is_bot(author), "draft": bool(pr.get("draft")),
            "baseRef": pr.get("baseRef"), "headRef": pr.get("headRef"), "workType": work_type(pr.get("title"), pr.get("headRef")),
            "labels": list(pr.get("labels") or []), "linkedWorkItems": list(pr.get("linkedWorkItems") or [])}


def size(pr, areas):
    """Lines changed when the source REPORTS them; a source that does not (Azure
    Repos) leaves them unknown -- never zero, which would make every one XS."""
    known = pr.get("additions") is not None or pr.get("deletions") is not None
    lines = (pr.get("additions") or 0) + (pr.get("deletions") or 0) if known else None
    per_area = Counter()
    for f in pr.get("files") or []:
        per_area[area_of(f.get("path") or "", areas)] += (f.get("additions") or 0) + (f.get("deletions") or 0)
    return {"additions": pr.get("additions") if known else None, "deletions": pr.get("deletions") if known else None, "linesChanged": lines,
            "changedFiles": pr.get("changedFiles"), "sizeBucket": size_bucket(lines) if known else "unknown", "areaLoc": dict(per_area) if known else {},
            "primaryArea": per_area.most_common(1)[0][0] if per_area else "(none)"}


def timing(pr, created, merged_at, closed_at, commits, cutoff):
    ready = first_event(pr, "ready", cutoff) or created
    first_commit = min((instant(c["committedAt"]) for c in commits), default=None)
    return {"readyAt": ready, "firstCommitAt": first_commit, "hoursOpen": hours(created, merged_at or closed_at),
            "hoursCycle": hours(created, merged_at), "hoursLead": hours(first_commit, merged_at),
            "hoursCoding": non_negative(hours(first_commit, created)), "ageDaysAtCutoff": round((cutoff - created).total_seconds() / 86400, 1)}


def non_negative(value):
    return value if value is not None and value >= 0 else None


def first_event(pr, kind, cutoff):
    return min((instant(e["at"]) for e in pr.get("events") or [] if e.get("type") == kind and before(e.get("at"), cutoff)), default=None)


def reviewing(pr, until, cutoff, commits, people):
    author = (pr.get("author") or {}).get("login")
    reviews = [r for r in pr.get("reviews") or [] if (r.get("author") or {}).get("login") != author and before(r.get("submittedAt"), cutoff)]
    pre = [r for r in reviews if instant(r["submittedAt"]) <= until]
    human = [r for r in pre if not people.is_bot(r.get("author"))]
    first_human = min((instant(r["submittedAt"]) for r in human), default=None)
    return {**review_counts(pre, human, reviews, people), **review_times(pr, pre, first_human, until, cutoff),
            **threads_of(pr, cutoff, people), "reworkCommits": sum(1 for c in commits if first_human and instant(c["committedAt"]) > first_human and instant(c["committedAt"]) <= until)}


def review_counts(pre, human, reviews, people):
    states = Counter(r.get("state") for r in pre)
    return {"humanReviews": len(human), "botReviews": len(pre) - len(human), "approvals": states.get("APPROVED", 0),
            "changesRequested": states.get("CHANGES_REQUESTED", 0), "postMergeReviews": len(reviews) - len(pre),
            "humanReviewers": sorted({(r.get("author") or {}).get("login") for r in human if (r.get("author") or {}).get("login")})}


def review_times(pr, pre, first_human, until, cutoff):
    approvals = [instant(r["submittedAt"]) for r in pre if r.get("state") == "APPROVED"]
    last_approval = max(approvals, default=None)
    merged = instant(pr.get("mergedAt")) if instant(pr.get("mergedAt")) and instant(pr.get("mergedAt")) < cutoff else None
    ready = first_event(pr, "ready", cutoff) or instant(pr.get("createdAt"))
    return {"firstHumanReviewAt": first_human, "hoursPickup": non_negative(hours(ready, first_human)),
            "hoursReview": non_negative(hours(first_human, last_approval or merged)), "hoursApprovalToMerge": non_negative(hours(last_approval, merged))}


def threads_of(pr, cutoff, people):
    threads = [t for t in pr.get("threads") or [] if before(t.get("startedAt"), cutoff)]
    comments = [c for c in pr.get("reviewComments") or [] if before(c.get("createdAt"), cutoff)]
    return {"threads": len(threads), "unresolvedAtCapture": sum(1 for t in threads if not t.get("resolved")),
            "reviewComments": len(comments), "reviewCommentsByBots": sum(1 for c in comments if people.is_bot(c.get("author")))}


def authored(commits, people, pr):
    ai = [c for c in commits if people.is_ai_commit(c)]
    merged_by = (pr.get("mergedBy") or {}).get("login")
    return {"commits": len(commits), "aiCommits": len(ai), "aiShare": round(len(ai) / len(commits), 3) if commits else None,
            "selfMerged": bool(merged_by) and merged_by == (pr.get("author") or {}).get("login")}
