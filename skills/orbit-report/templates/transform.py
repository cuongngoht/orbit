"""{{DOC}}

A project-report TRANSFORM part, made for: {{NEED}}

It derives a new collection from the frozen snapshot and writes it beside it
(sdk.write); later parts read it with sdk.derived(name). It never changes the
snapshot itself.
"""


def run(envelope, sdk):
    rows = sdk.collection("pullRequests")
    sdk.write("{{NAME}}.json", [{"id": r["id"], "repo": r.get("repo")} for r in rows])
    return {}
