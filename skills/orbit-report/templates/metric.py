"""{{DOC}}

A project-report METRIC part, made for: {{NEED}}

It reads the frozen snapshot through `sdk` and records only the metrics its
reporting.json declares -- the id, unit and definition come from there. What the
snapshot does not hold is a gap: sdk.collection() raises sdk.DataMissing for a
collection the source could not give, and a part raises it itself for anything
else it needs. Never a zero for something unknown, and nothing after sdk.cutoff.
"""


def run(envelope, sdk):
    rows = sdk.collection("pullRequests")
    known = [r for r in rows if sdk.before_cutoff(r.get("createdAt"))]
    sdk.metric("{{METRIC}}", value=len(known), basis={"samples": len(known)})
    return {}
