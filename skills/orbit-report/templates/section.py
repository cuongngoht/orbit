"""{{DOC}}

A project-report SECTION part, made for: {{NEED}}

It lays out plain blocks -- sdk.tiles, sdk.table, sdk.chart, sdk.text, sdk.notes
-- from the snapshot or from the metrics earlier parts recorded (sdk.metrics()).
The renderer escapes every string; a link is a cell {"url": ..., "text": ...} and
is shown only when it points at the report's own source.
"""


def run(envelope, sdk):
    rows = sdk.collection("pullRequests")
    sdk.section([sdk.tiles([sdk.tile("Pull requests in the snapshot", len(rows))])])
    return {}
