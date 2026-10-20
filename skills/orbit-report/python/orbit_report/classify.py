"""What a pull request IS, read off its words -- and what cannot be read, said so.

Three questions, each answered by data a project can override in its report
settings (`mapping`), because none of them is a fact this kit may assume:

  work type   the conventional-commit prefix of the title (`feat:`, `fix(ui):`),
              else a keyword in the title or branch, else UNCLASSIFIED. The ZIP
              this kit came from answered "feat" when it could not tell, which
              made a repository that never writes prefixes look like pure
              feature work and fed that into the forecast.
  bot         an account the source itself marks as a bot, a `[bot]` login, or
              a login the project lists
  AI commit   a commit whose author, committer or trailer carries a marker the
              project lists -- a FLOOR: AI work committed under a person's name
              is invisible to it
"""
import os
import re

WORK_TYPES = ["feat", "fix", "refactor", "chore", "docs", "ci", "perf", "test", "unclassified"]

PREFIXES = {"feat": "feat", "feature": "feat", "features": "feat", "fix": "fix", "hotfix": "fix", "bugfix": "fix", "bug": "fix",
            "refactor": "refactor", "chore": "chore", "build": "chore", "style": "chore", "deps": "chore", "docs": "docs", "doc": "docs",
            "ci": "ci", "perf": "perf", "test": "test", "tests": "test", "revert": "chore"}

KEYWORDS = [
    ("fix", r"\b(hotfix|fix|fixes|fixed|bug|broken|resolve[sd]?|repair|regression)\b"),
    ("refactor", r"\b(refactor\w*|cleanup|clean up)\b"),
    ("chore", r"\b(bump|upgrade|dependenc\w*|chore|submodule)\b"),
    ("docs", r"\b(docs?|readme|documentation)\b"),
    ("ci", r"\b(ci|workflow|pipeline|github action)\b"),
    ("test", r"\b(tests?|specs?)\b"),
    # Only the word itself: "add"/"support" read as features would rebuild the
    # very over-count this module exists to stop.
    ("feat", r"\b(feat|feature|features)\b"),
]

DEFAULT_BOTS = ["github-actions", "dependabot", "renovate", "copilot-pull-request-reviewer", "codecov", "sonarcloud", "coderabbitai"]
DEFAULT_AI_MARKERS = ["noreply@anthropic.com", "co-authored-by: claude", "claude code", "copilot"]

PREFIX = re.compile(r"^\s*([A-Za-z]+)(\([^)]*\))?!?:")


def work_type(title, branch=""):
    match = PREFIX.match(title or "")
    if match and match.group(1).lower() in PREFIXES:
        return PREFIXES[match.group(1).lower()]
    words = f"{title or ''} {(branch or '').replace('/', ' ').replace('-', ' ').replace('_', ' ')}".lower()
    return next((kind for kind, pattern in KEYWORDS if re.search(pattern, words)), "unclassified")


class People:
    """Who is a bot and which commit is AI-authored, as this project decided."""

    def __init__(self, mapping=None):
        mapping = mapping or {}
        self.bots = {b.lower() for b in mapping.get("bots", DEFAULT_BOTS)}
        self.markers = [m.lower() for m in mapping.get("aiMarkers", DEFAULT_AI_MARKERS)]

    def is_bot(self, actor):
        if not actor:
            return False
        login = str(actor.get("login") or "").lower()
        return bool(actor.get("bot")) or login.endswith("[bot]") or login in self.bots

    def is_ai_commit(self, commit):
        people = [commit.get("author") or {}, commit.get("committer") or {}]
        blob = " ".join(str(p.get(k) or "") for p in people for k in ("name", "email", "login")) + " " + str(commit.get("message") or "")
        return any(marker in blob.lower() for marker in self.markers)


def size_bucket(lines):
    for limit, name in ((10, "XS"), (100, "S"), (500, "M"), (1000, "L")):
        if lines <= limit:
            return name
    return "XL"


MONOREPO_ROOTS = ("src", "apps", "packages", "services", "libs")


def area_of(path, areas):
    """The configured area a path belongs to, else its own top folder (or src/<x>)."""
    for area in areas or []:
        if any(path == p or path.startswith(p.rstrip("/") + "/") for p in area.get("prefixes", [])):
            return area["label"]
    parts = path.split("/")
    if parts[0] in MONOREPO_ROOTS and len(parts) > 2:
        return "/".join(parts[:2])
    return parts[0] if len(parts) > 1 else "(root)"


def extension_of(path):
    return os.path.splitext(path)[1] or "(none)"
