"""What a report part is handed -- the Python counterpart of the engine's
extension context: a few surfaces, and the absences are the point.

    sdk.collection(name)     a snapshot collection; DataMissing when the source
                             could not give it (forbidden, missing, not configured)
    sdk.completeness(name)   what the collector said about that collection
    sdk.snapshot()           the whole frozen snapshot (read-only)
    sdk.metrics()            metric records earlier parts produced
    sdk.model()              the standard metrics' model, for a section that
                             builds on it
    sdk.calendar / cutoff / window / local_date / in_window
    sdk.metric(...)          record a metric the part DECLARED -- id, unit and
                             definition come from the declaration, never from here
    sdk.section(...), tile / table / chart / text / notes   plain-text blocks
    sdk.write(name, obj)     a JSON file inside the part's own output directory
    sdk.log(...)             a line on stderr

Absent on purpose: a credential, the network, the store, the settings of any
other part, and any way to write a verdict about the product.
"""
import json
import os
import re
import sys

from .timecal import Calendar, instant

RESULT = "orbit.report.part-result/v1"
NAME = re.compile(r"^[a-z0-9][a-z0-9._-]{0,63}\.json$")
EXPORT = re.compile(r"^[a-z0-9][a-z0-9._-]{0,63}\.(csv|json|md|txt)$")
UNUSABLE = {"forbidden", "missing", "not-configured"}
BLOCKS = {"tiles", "table", "chart", "text", "notes"}


class DataMissing(Exception):
    """The data a part needs is not in this snapshot -- a gap, never a zero."""

    def __init__(self, missing, message=None):
        self.missing = list(missing)
        super().__init__(message or f"this snapshot has no usable {', '.join(self.missing)}")


class Sdk:
    def __init__(self, envelope):
        self.envelope = envelope
        self.part = envelope["part"]
        self.window = envelope["run"]["window"]
        self.calendar = Calendar(envelope["run"]["calendar"])
        self.cutoff = instant(self.window["cutoffUtc"])
        self.start = instant(self.window.get("fromUtc"))
        self.end = instant(self.window["toUtc"])
        self.settings = envelope.get("settings") or {}
        self.output = envelope["output"]["dir"]
        self._inputs = envelope.get("inputs") or {}
        self._cache = {}
        self._metrics = []
        self._sections = []
        self._files = {}
        self._exports = []
        self._declared = {m["id"]: m for m in self.part.get("metrics") or []}

    # ---- reading -------------------------------------------------------------

    def readable_roots(self):
        paths = [self.output, os.path.dirname(self.part["entry"])]
        paths += [os.path.dirname(p) for p in self._input_files()]
        return paths + list(self._inputs.get("roots") or [])

    def _input_files(self):
        found = [self._inputs.get("snapshot"), self._inputs.get("model")]
        found += list(self._inputs.get("metrics") or []) + list(self._inputs.get("derived") or [])
        return [p for p in found if p]

    def _load(self, path):
        if path not in self._cache:
            with open(path, encoding="utf-8") as handle:
                self._cache[path] = json.load(handle)
        return self._cache[path]

    def snapshot(self):
        if not self._inputs.get("snapshot"):
            raise DataMissing(["snapshot"], "this part was run without a snapshot")
        return self._load(self._inputs["snapshot"])

    def completeness(self, name):
        return (self.snapshot().get("completeness") or {}).get(name) or {"status": "missing", "reason": "the collector did not report it"}

    def collection(self, name):
        state = self.completeness(name)
        if state.get("status") in UNUSABLE:
            raise DataMissing([name], f"{name}: {state.get('reason') or state.get('status')}")
        return (self.snapshot().get("collections") or {}).get(name) or []

    def has(self, name):
        return self.completeness(name).get("status") not in UNUSABLE

    def metrics(self):
        return [m for path in self._inputs.get("metrics") or [] for m in self._load(path)]

    def model(self):
        if not self._inputs.get("model"):
            raise DataMissing(["model"], "the standard metrics did not run before this part")
        return self._load(self._inputs["model"])

    def derived(self, name):
        for path in self._inputs.get("derived") or []:
            if os.path.basename(path) == f"{name}.json":
                return self._load(path)
        raise DataMissing([name], f"no transform produced {name}")

    # ---- time ------------------------------------------------------------------

    def local_date(self, text):
        return self.calendar.local_date(instant(text))

    def before_cutoff(self, text):
        moment = instant(text)
        return moment is not None and moment < self.cutoff

    def in_window(self, text):
        moment = instant(text)
        return moment is not None and (self.start is None or moment >= self.start) and moment < self.end

    # ---- recording -------------------------------------------------------------

    def metric(self, metric_id, value=None, series=None, table=None, basis=None, missing=None):
        declared = self._declared.get(metric_id)
        if declared is None:
            raise ValueError(f"{metric_id} was not declared by {self.part['id']}; declare it with its unit and definition first")
        record = {k: declared.get(k) for k in ("id", "version", "label", "unit", "definition")}
        record.update(value=value, series=series, table=table, basis=basis or {}, missing=list(missing or []))
        record["provenance"] = {"part": self.part["id"], "partVersion": self.part.get("version")}
        self._metrics.append(record)
        return record

    def section(self, blocks, title=None, summary=None):
        wrong = [b.get("type") for b in blocks if b.get("type") not in BLOCKS]
        if wrong:
            raise ValueError(f"unknown block type(s): {wrong}; a section is made of {sorted(BLOCKS)}")
        self._sections.append({"title": title, "summary": summary, "blocks": blocks})

    @staticmethod
    def tile(label, value, unit=None, note=None):
        return {"label": str(label), "value": value, "unit": unit, "note": note}

    @staticmethod
    def tiles(items):
        return {"type": "tiles", "items": items}

    @staticmethod
    def table(columns, rows, title=None):
        return {"type": "table", "title": title, "columns": [str(c) for c in columns], "rows": rows}

    @staticmethod
    def chart(kind, labels, series, title=None, unit=None, stacked=False):
        return {"type": "chart", "kind": kind, "title": title, "unit": unit, "stacked": stacked, "labels": labels, "series": series}

    @staticmethod
    def text(body, title=None):
        return {"type": "text", "title": title, "body": str(body)}

    @staticmethod
    def notes(items, title=None):
        return {"type": "notes", "title": title, "items": [str(i) for i in items]}

    def write(self, name, obj):
        if not NAME.match(name):
            raise ValueError(f"{name}: an output is a flat, lower-case .json name")
        with open(os.path.join(self.output, name), "w", encoding="utf-8", newline="\n") as handle:
            json.dump(obj, handle, ensure_ascii=False)
        self._files[name[:-5]] = name
        return name

    def export(self, name, text):
        """A file an EXPORTER puts beside the report, in a format it declared."""
        if not EXPORT.match(name):
            raise ValueError(f"{name}: an export is a flat, lower-case name ending .csv, .json, .md or .txt")
        if name.rsplit(".", 1)[1] not in (self.part.get("formats") or []):
            raise ValueError(f"{name}: this part declared {self.part.get('formats') or 'no formats'}")
        with open(os.path.join(self.output, name), "w", encoding="utf-8", newline="\n") as handle:
            handle.write(str(text))
        self._exports.append(name)
        return name

    @staticmethod
    def log(*parts):
        print(*parts, file=sys.stderr)

    # ---- finishing -------------------------------------------------------------

    def finish(self, returned):
        returned = returned or {}
        if self._metrics:
            self.write("metrics.json", self._metrics)
        if self._sections:
            self.write("section.json", self._sections)
        return {"contract": RESULT, "status": returned.get("status", "ok"), "outputs": dict(self._files), "exports": list(self._exports),
                "notes": [str(n) for n in returned.get("notes", [])], "missing": list(returned.get("missing", []))}


# A part raises sdk.DataMissing([...]) for a gap -- the one door it needs to the
# class, so a store part never has to import the kit by name.
Sdk.DataMissing = DataMissing
