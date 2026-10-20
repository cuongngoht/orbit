"""Planning documents (a BMAD-style tree, parsed by the bmad collector) rolled up
into requirement, epic and story status -- with the basis of every answer shown.

The kit this came from had two roll-up bugs, fixed here:

  * a requirement was "done" as soon as ONE story mentioning it was done. A
    requirement is done only when EVERY story that implements it is done, and a
    story that merely MENTIONS a requirement in its text implements nothing: a
    mention-only requirement is `unknown`, with the mentions shown as a hint
  * an epic was "done" when every story FILE was done, while stories the plan
    listed and nobody had written yet were ignored. A planned story without a
    file is a story not built.
"""
from collections import Counter, defaultdict

DONE, PARTIAL, DEFERRED, NOT_BUILT = "done", "partial", "deferred", "not-built"


def rollup(docs):
    stories = {s["id"]: s for s in docs.get("stories") or []}
    implements, mentions = links_by(docs.get("links") or [])
    epics = [epic_row(e, stories) for e in docs.get("epics") or []]
    requirements = [requirement_row(r, implements, mentions, stories) for r in docs.get("requirements") or []]
    return {"source": docs.get("source"), "pointInTime": bool(docs.get("pointInTime")), "commit": docs.get("commit"), "epics": epics, "requirements": requirements,
            "stories": list(stories.values()), "summary": summary(requirements, stories, epics)}


def links_by(links):
    implements, mentions = defaultdict(set), defaultdict(set)
    for link in links:
        (implements if link.get("kind") == "implements" else mentions)[link["requirement"]].add(link["story"])
    return implements, mentions


def epic_row(epic, stories):
    planned = list(epic.get("plannedStories") or [])
    written = [s for s in stories.values() if s.get("epic") == epic["id"]]
    ids = sorted(set(planned) | {s["id"] for s in written})
    states = [stories[i]["status"] if i in stories else NOT_BUILT for i in ids]
    return {"id": epic["id"], "title": epic.get("title") or f"Epic {epic['id']}", "stories": len(ids), "done": states.count(DONE),
            "inProgress": states.count(PARTIAL), "notBuilt": states.count(NOT_BUILT), "deferred": states.count(DEFERRED),
            "withoutFile": [i for i in planned if i not in stories], "status": epic_status(states)}


def epic_status(states):
    live = [s for s in states if s != DEFERRED]
    if not live:
        return "no stories" if not states else "deferred"
    if all(s == DONE for s in live):
        return "done"
    return "in progress" if any(s in (DONE, PARTIAL) for s in live) else "not started"


def requirement_row(req, implements, mentions, stories):
    doing = sorted(implements.get(req["id"], ()))
    hinted = sorted(mentions.get(req["id"], ()) - set(doing))
    status, basis = judged(req, doing, hinted, stories)
    return {"id": req["id"], "title": req.get("title") or "", "epic": req.get("epic"), "section": req.get("section"), "status": status, "basis": basis,
            "implementedBy": doing, "mentionedBy": hinted}


def judged(req, doing, hinted, stories):
    if req.get("deferred"):
        return DEFERRED, "marked deferred"
    if doing:
        return combined([stories[s]["status"] if s in stories else NOT_BUILT for s in doing]), f"{len(doing)} implementing stor{'y' if len(doing) == 1 else 'ies'}"
    if hinted:
        return "unknown", f"no story implements it; mentioned by {len(hinted)} ({hint(hinted, stories)})"
    return "unknown", "no story is linked to it"


def combined(states):
    live = [s for s in states if s != DEFERRED]
    if not live:
        return DEFERRED
    if all(s == DONE for s in live):
        return DONE
    return PARTIAL if any(s in (DONE, PARTIAL) for s in live) else NOT_BUILT


def hint(ids, stories):
    tally = Counter(stories[s]["status"] if s in stories else NOT_BUILT for s in ids)
    return ", ".join(f"{n} {state}" for state, n in tally.most_common())


def summary(requirements, stories, epics):
    rc, sc = Counter(r["status"] for r in requirements), Counter(s["status"] for s in stories.values())
    return {"requirements": len(requirements), "requirementsDone": rc.get(DONE, 0), "requirementsPartial": rc.get(PARTIAL, 0),
            "requirementsNotBuilt": rc.get(NOT_BUILT, 0), "requirementsUnknown": rc.get("unknown", 0), "requirementsDeferred": rc.get(DEFERRED, 0),
            "stories": len(stories), "storiesDone": sc.get(DONE, 0), "storiesPartial": sc.get(PARTIAL, 0), "storiesNotBuilt": sc.get(NOT_BUILT, 0),
            "storiesWithoutFile": sum(len(e["withoutFile"]) for e in epics)}


def remaining_stories(rolled):
    s = rolled["summary"]
    return s["storiesNotBuilt"] + 0.5 * s["storiesPartial"] + s["storiesWithoutFile"]
