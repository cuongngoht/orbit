"""The one door a project-report PART is run through.

    python -I -S -B -X utf8 orbit_part.py  < envelope.json  > result.json

The engine (src/project-report/execute.mjs) hands a part ONE JSON envelope on
stdin -- contract orbit.report.part/v1 -- and reads ONE JSON result from stdout.
Everything a part prints is a log line: stdout is swapped for stderr before the
part is even loaded, so data and logs can never mix.

`-I -S` is isolated mode without site-packages: no PYTHON* variables, no user
site, no .pth files, and -- since Python 3.4 -- not even the script's own
directory on sys.path. So this file puts the kit on sys.path itself, and a part
is loaded BY ITS FILE PATH, never by a name something else could shadow.

A part is a module with `run(envelope, sdk)`. It reads through `sdk` (the
snapshot, earlier metrics, the calendar) and records through it; it never
receives a credential, and a guard (orbit_report.guard) refuses sockets,
processes and writes outside its output directory. That guard is a second lock,
not a sandbox: a part runs as the user who ran the report.

Exit codes: 0 done · 2 the data it needs is missing (a data gap, not a bug) ·
3 the part itself failed.
"""
import importlib.util
import json
import os
import sys
import traceback

KIT = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, KIT)

from orbit_report import guard, sdk  # noqa: E402  (the kit is on sys.path only now)

RESULT = "orbit.report.part-result/v1"


def main():
    data_out = sys.stdout
    sys.stdout = sys.stderr
    code, result = attempted(json.loads(sys.stdin.read()))
    data_out.write(json.dumps(result, ensure_ascii=False))
    data_out.flush()
    return code


def attempted(envelope):
    try:
        return 0, completed(envelope)
    except sdk.DataMissing as gap:
        return 2, {"contract": RESULT, "status": "unavailable", "missing": gap.missing, "notes": [str(gap)], "outputs": {}}
    except BaseException as crash:  # a part's SystemExit is its own crash too
        traceback.print_exc(file=sys.stderr)
        return 3, {"contract": RESULT, "status": "failed", "notes": [f"{type(crash).__name__}: {crash}"], "outputs": {}}


def completed(envelope):
    tools = sdk.Sdk(envelope)
    guard.install(envelope, tools.readable_roots())
    returned = loaded(envelope["part"]["entry"]).run(envelope, tools)
    return tools.finish(returned)


def loaded(path):
    module = kit_module(path) or file_module(path)
    if not callable(getattr(module, "run", None)):
        raise TypeError("a part is a module with run(envelope, sdk)")
    return module


def kit_module(path):
    """A standard part lives in this kit's package and imports its siblings."""
    try:
        relative = os.path.relpath(os.path.abspath(path), KIT)
    except ValueError:  # on another drive (Windows): not a file of this kit
        return None
    if relative.startswith("..") or os.path.isabs(relative) or not relative.endswith(".py"):
        return None
    return importlib.import_module(relative[:-3].replace(os.sep, "."))


def file_module(path):
    """A project's part is loaded by its FILE, under a name nothing else has."""
    spec = importlib.util.spec_from_file_location("orbit_report_part", path)
    if spec is None or spec.loader is None:
        raise ImportError(f"no part at {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


if __name__ == "__main__":
    sys.exit(main())
