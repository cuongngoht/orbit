"""The standard planning-documents collector (orbit.report.bmad): a BMAD-style
tree -- stories with a `Status:` line, an epics file, a PRD with functional
requirements -- parsed into the snapshot's `documents` collection.

It reads a directory the ENGINE prepared and handed in (inputs.roots): the docs
as they were at the last commit before the cut-off when they live in Git, so a
report about the past never reads a story's status from the future. It needs no
credential and opens no connection; where the tree lives is the project's
setting, and no submodule or folder layout is assumed beyond the file shapes.

Links are kept by KIND, because they mean different things:
  implements   a story's own section in the epics file lists the requirement --
               the plan saying this story delivers it
  mentions     a story file names the requirement somewhere in its text
Only `implements` can make a requirement done (documents.py).
"""
import os
import re

DONE = {"done", "complete", "completed", "shipped", "released"}
PARTIAL = {"partially-implemented", "partial", "in-progress", "in progress", "review", "in-review", "testing"}
DEFERRED = {"deferred", "cancelled", "canceled", "retired", "wont-do", "won't do", "dropped"}
FR_REF = re.compile(r"\bFR-?(\d{1,3}[a-z]?)\b")
STORY_HEAD = re.compile(r"^#\s*Story\s+(\d+[a-z]?)\.(\d+[a-z]?)\s*:\s*(.+?)\s*$", re.M)
STATUS = re.compile(r"^\**Status\**\s*:\s*\**(.+?)\**\s*$", re.M)
EPIC_OR_STORY = re.compile(r"^(##|###)\s+(Epic|Story)\s+(\d+[a-z]?)(?:\.(\d+[a-z]?))?\s*:\s*(.+?)\s*$", re.M)
COVERAGE = re.compile(r"^FR-?(\d{1,3}[a-z]?)\s*:\s*Epic\s+(\d+[a-z]?)", re.M)
REQUIREMENT = re.compile(r"^\s*(?:[-*]|#{3,5})\s*\**FR-?(\d{1,3}[a-z]?)\**\s*:\s*(.+?)\s*$")


def run(envelope, sdk):
    root = base_of(((envelope.get("inputs") or {}).get("roots") or [None])[0])
    if root is None:
        return {"status": "unavailable", "notes": ["no planning documents were handed to this collector"], "missing": ["documents"]}
    parsed = parse(root)
    parsed.update(source=(envelope.get("settings") or {}).get("docsLabel") or os.path.basename(root), pointInTime=bool(sdk.settings.get("pointInTime")), commit=sdk.settings.get("commit"))
    sdk.write("documents.json", parsed)
    return {}


def base_of(root):
    if not root or not os.path.isdir(root):
        return None
    nested = os.path.join(root, "_bmad-output")
    return nested if os.path.isdir(nested) else root


def status_of(raw):
    value = raw.strip().strip("*").strip().lower()
    for group, name in ((DONE, "done"), (PARTIAL, "partial"), (DEFERRED, "deferred")):
        if value in group:
            return name
    return "not-built"


def fr_id(number):
    return f"FR{number}"


def parse(base):
    stories = read_stories(base)
    epics_text, prd_text = planning(base, "epics"), planning(base, "prd")
    epics, story_epic, implements, deferred = read_epics(epics_text)
    for sid, epic in story_epic.items():
        if sid in stories:
            stories[sid]["epic"] = epic
    links = [{"requirement": fr, "story": s, "kind": "implements"} for fr, ids in sorted(implements.items()) for s in sorted(ids)]
    links += [{"requirement": fr_id(n), "story": s["id"], "kind": "mentions"} for s in stories.values() for n in s.pop("refs")]
    return {"kind": "bmad", "stories": sorted(stories.values(), key=lambda s: s["id"]), "epics": epics,
            "requirements": read_requirements(prd_text, coverage(epics_text), deferred), "links": links}


def read_stories(base):
    folder = os.path.join(base, "implementation-artifacts")
    stories = {}
    for name in sorted(os.listdir(folder)) if os.path.isdir(folder) else []:
        if name.endswith(".md"):
            story = story_of(name, text(os.path.join(folder, name)))
            if story:
                stories[story["id"]] = story
    return stories


def story_of(name, body):
    head = STORY_HEAD.search(body)
    if not head:
        return None
    status = STATUS.search(body)
    return {"id": f"{head.group(1)}.{head.group(2)}", "epic": head.group(1), "title": head.group(3), "file": name,
            "statusRaw": status.group(1).strip() if status else "unknown", "status": status_of(status.group(1)) if status else "not-built",
            "refs": sorted(set(FR_REF.findall(body)))}


def text(path):
    with open(path, encoding="utf-8", errors="replace") as handle:
        return handle.read().replace("\r\n", "\n")


def planning(base, name):
    folder = os.path.join(base, "planning-artifacts")
    direct = os.path.join(folder, f"{name}.md")
    if os.path.isfile(direct):
        return text(direct)
    nested = os.path.join(folder, f"{name}s")
    found = sorted(os.path.join(nested, d, f"{name}.md") for d in (os.listdir(nested) if os.path.isdir(nested) else []))
    found = [f for f in found if os.path.isfile(f)]
    return text(found[-1]) if found else ""


def read_epics(body):
    epics, story_epic, current = {}, {}, None
    for m in EPIC_OR_STORY.finditer(body):
        level, kind, prefix, num, title = m.groups()
        if kind == "Epic" and level == "##":
            current = prefix
            epics.setdefault(prefix, {"id": prefix, "title": re.sub(r"\s*\*\(.*?\)\*\s*$", "", title).strip(), "plannedStories": []})
        elif kind == "Story" and level == "###" and num is not None:
            eid = current if current and current.rstrip("abcdefghijklmnopqrstuvwxyz") == prefix.rstrip("abcdefghijklmnopqrstuvwxyz") else prefix
            story_epic[f"{prefix}.{num}"] = eid
            epics.setdefault(eid, {"id": eid, "title": f"Epic {eid}", "plannedStories": []})["plannedStories"].append(f"{prefix}.{num}")
    implements, deferred = story_requirements(body)
    return list(epics.values()), story_epic, implements, deferred


def story_requirements(body):
    implements, deferred = {}, set()
    for section in re.split(r"^(?=###\s+Story\s+\d+[a-z]?\.\d+)", body, flags=re.M):
        head = re.match(r"###\s+Story\s+(\d+[a-z]?\.\d+[a-z]?)[^\n]*", section)
        if not head:
            continue
        ids = {fr_id(n) for n in FR_REF.findall(section)}
        if re.search(r"\bdeferred\b", "\n".join(section.splitlines()[:4]), re.I):
            deferred |= ids
        for fr in ids:
            implements.setdefault(fr, set()).add(head.group(1))
    for m in re.finditer(r"^.*\bFR-?(\d{1,3}[a-z]?)\b.*\bDeferred\b.*$", body, re.M | re.I):
        deferred.add(fr_id(m.group(1)))
    return implements, deferred


def coverage(body):
    return {fr_id(m.group(1)): m.group(2) for m in COVERAGE.finditer(body)}


def read_requirements(body, epic_of, deferred):
    found, section = {}, ""
    for line in body.splitlines():
        heading = re.match(r"^###\s+(.+?)\s*$", line)
        section = heading.group(1) if heading else section
        m = REQUIREMENT.match(line)
        if m:
            rid = fr_id(m.group(1))
            found[rid] = {"id": rid, "title": m.group(2)[:140], "section": section, "epic": epic_of.get(rid),
                          "deferred": bool(re.search(r"\bdeferred\b", line, re.I)) or rid in deferred}
    return sorted(found.values(), key=lambda r: natural(r["id"]))


def natural(rid):
    m = re.match(r"FR(\d+)([a-z]?)", rid)
    return (int(m.group(1)), m.group(2)) if m else (0, rid)
