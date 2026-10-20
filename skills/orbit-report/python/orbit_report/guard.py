"""A second lock on what a report part can reach -- NOT a sandbox.

A part computes over a frozen snapshot. It has no reason to open a socket,
start a process, load a native library, or write anywhere but its own output
directory, so an audit hook (PEP 578) refuses all of that, and refuses reading
outside the few directories the part was pointed at. A part that tries is
stopped with an error the report shows as that part's failure.

What this is NOT: a boundary against hostile code. Code running as this user
could remove the reasons it exists, and the README says so. What it catches is
the ordinary mistake -- a generated metric that "just fetches one more thing",
or writes a cache beside the plugin -- before it becomes a habit.
"""
import os
import sys

REFUSED = (
    "socket.connect", "socket.bind", "socket.getaddrinfo", "socket.gethostbyname", "socket.sendto",
    "subprocess.Popen", "os.system", "os.exec", "os.posix_spawn", "os.spawn", "os.fork", "os.forkpty",
    "os.startfile", "ctypes.dlopen", "ctypes.dlsym", "ctypes.call_function", "webbrowser.open",
    "urllib.Request", "http.client.connect", "ftplib.connect", "smtplib.connect",
)

WRITE_FLAGS = os.O_WRONLY | os.O_RDWR | os.O_APPEND | os.O_CREAT | os.O_TRUNC

# Devices a standard library may read without asking anyone.
DEVICES = {"/dev/urandom", "/dev/random", "/dev/null"}


def install(envelope, readable):
    output = folded(envelope["output"]["dir"])
    roots = [folded(r) for r in readable if r] + interpreter_roots()
    sys.addaudithook(lambda event, args: judged(event, args, output, roots))


def interpreter_roots():
    places = [sys.prefix, sys.base_prefix, sys.exec_prefix, *[p for p in sys.path if p]]
    return sorted({folded(p) for p in places} | {folded(os.path.realpath(p)) for p in places})


def judged(event, args, output, roots):
    if event in REFUSED or event.startswith(("socket.", "subprocess.")):
        raise PermissionError(f"a report part may not use {event}: it computes over the snapshot it was given")
    if event == "open":
        opened(args, output, roots)


def opened(args, output, roots):
    path, mode, flags = (list(args) + [None, None, None])[:3]
    if not isinstance(path, (str, bytes, os.PathLike)):
        return
    target = folded(os.fsdecode(path))
    if writes(mode, flags) and not inside(target, [output]):
        raise PermissionError(f"a report part may write only inside its output directory, not {os.fsdecode(path)}")
    if not writes(mode, flags) and target not in DEVICES and not inside(target, [output] + roots):
        raise PermissionError(f"a report part may read only what it was handed, not {os.fsdecode(path)}")


def writes(mode, flags):
    if isinstance(mode, str):
        return any(c in mode for c in "wax+")
    return isinstance(flags, int) and bool(flags & WRITE_FLAGS)


def folded(path):
    return os.path.normcase(os.path.abspath(path))


def inside(target, roots):
    return any(within(target, root) for root in roots)


def within(target, root):
    try:
        return os.path.commonpath([target, root]) == root
    except ValueError:  # another drive on Windows
        return False
