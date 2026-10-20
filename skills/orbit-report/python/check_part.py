"""A STATIC look at a project's report part before it is registered.

    python -I -S -B -X utf8 check_part.py <part.py>   -> one JSON line: {"problems": [...]}

A part computes over a frozen snapshot, so everything it needs is in Python's
pure computing modules. This refuses the rest by name: another module (the
filesystem, processes, the network, native code, importing by string), and the
builtins that reach around the SDK (open, eval, exec, compile, __import__) or
into the interpreter's internals (dunder attributes). It is a lint that says
what it found -- the audit guard the shim installs is the second lock, and
neither is a sandbox: a part runs as the user who runs the report.
"""
import ast
import json
import sys

ALLOWED = {"json", "math", "statistics", "datetime", "collections", "itertools", "functools", "re", "dataclasses", "typing",
           "decimal", "fractions", "operator", "bisect", "heapq", "string", "textwrap", "enum", "copy", "random", "calendar", "numbers"}
BUILTINS = {"open", "eval", "exec", "compile", "__import__", "input", "breakpoint", "globals", "locals", "vars", "memoryview", "help", "exit", "quit"}
DUNDERS = {"__subclasses__", "__globals__", "__builtins__", "__code__", "__closure__", "__getattribute__", "__loader__", "__spec__", "__dict__", "__class__", "__bases__", "__mro__"}


def problems(tree):
    found = []
    for node in ast.walk(tree):
        found += imported(node) + called(node) + reached(node)
    return found


def imported(node):
    if isinstance(node, ast.Import):
        return [f"line {node.lineno}: imports {a.name}, which a report part may not use" for a in node.names if a.name.split(".")[0] not in ALLOWED]
    if isinstance(node, ast.ImportFrom):
        name = node.module or ""
        if node.level:
            return [f"line {node.lineno}: a relative import; a part is one file that talks to the kit only through sdk"]
        return [] if name.split(".")[0] in ALLOWED else [f"line {node.lineno}: imports from {name}, which a report part may not use"]
    return []


def called(node):
    if isinstance(node, ast.Name) and node.id in BUILTINS:
        return [f"line {node.lineno}: uses {node.id}(); a part reads and writes only through sdk"]
    return []


def reached(node):
    if isinstance(node, ast.Attribute) and node.attr in DUNDERS:
        return [f"line {node.lineno}: reaches {node.attr}, an interpreter internal"]
    return []


def main(path):
    with open(path, encoding="utf-8") as handle:
        source = handle.read()
    try:
        tree = ast.parse(source, filename=path)
    except SyntaxError as e:
        return {"problems": [f"line {e.lineno}: not valid Python ({e.msg})"]}
    return {"problems": problems(tree) + ([] if has_run(tree) else ["a part defines run(envelope, sdk)"])}


def has_run(tree):
    return any(isinstance(n, ast.FunctionDef) and n.name == "run" and len(n.args.args) == 2 for n in tree.body)


if __name__ == "__main__":
    print(json.dumps(main(sys.argv[1])))
