"""The few summary statistics every section uses, each honest about an empty input:
nothing to summarise is None, never 0."""
import statistics


def present(values):
    return [v for v in values if v is not None]


def med(values):
    values = present(values)
    return round(statistics.median(values), 2) if values else None


def total(values):
    """A sum over what is known -- None when nothing is, so an unknown size is
    never summed into a zero."""
    values = present(values)
    return sum(values) if values else None


def mean(values):
    values = present(values)
    return round(sum(values) / len(values), 2) if values else None


def pct(values):
    """Nearest-rank percentiles, with the sample size they were taken over."""
    values = sorted(present(values))
    if not values:
        return {"n": 0}
    n = len(values)
    rank = lambda p: values[min(n - 1, int(round(p * (n - 1))))]
    return {"min": values[0], "p25": rank(.25), "p50": rank(.5), "p75": rank(.75), "p85": rank(.85), "p90": rank(.9), "max": values[-1], "n": n}


def share(part, whole):
    """A percentage with one decimal -- None when there is no whole to be a share of."""
    return round(part / whole * 100, 1) if whole else None


def count(items, predicate):
    return sum(1 for item in items if predicate(item))
