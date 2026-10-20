"""{{DOC}}

A project-report EXPORTER part, made for: {{NEED}}

It writes another format beside the report with sdk.export(name, text) -- csv,
json, md or txt, as reporting.json declares -- from the metrics and the model
the standard parts made. It computes nothing new.
"""


def run(envelope, sdk):
    lines = ["id,label,value,unit"] + [f'{m["id"]},"{m["label"]}",{m.get("value")},{m["unit"]}' for m in sdk.metrics()]
    sdk.export("{{NAME}}.csv", "\n".join(lines) + "\n")
    return {}
