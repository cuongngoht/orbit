"""{{DOC}}

A project-report COLLECTOR part, made for: {{NEED}}

It reads a LOCAL source the engine prepared and handed in (inputs.roots) and
adds one collection to the snapshot before it is frozen, named under this
extension's id. It never reaches the project's source API: that, and its
credential, stay with the standard collectors.
"""


def run(envelope, sdk):
    roots = (envelope.get("inputs") or {}).get("roots") or []
    if not roots:
        raise sdk.DataMissing(["report.docs"], "no local source was handed to this collector")
    sdk.write("{{COLLECTION}}.json", {"items": []})
    return {}
