"""The standard forecast part (orbit.report.forecast): a Monte Carlo over the
throughput THIS window measured -- or no forecast, with the reason.

Two bugs of the kit this came from are exactly what this file refuses to do:

  * with no samples it drew "1 per iteration" from nowhere, and printed dates
  * with only zeros it ran to its 200-iteration cap and printed THAT date

Here a forecast needs at least `minSamples` complete periods and at least one
of them with something completed; otherwise the page says which is missing. A
simulated run that has not finished by the horizon is counted as unfinished,
and a percentile that falls on unfinished runs reads "beyond the horizon",
never a date. It never reads more history than the window already collected.
The seed and the model version are recorded so the numbers can be reproduced.
"""
import random
from datetime import date, timedelta

MODEL = "orbit.forecast.mc/1"
DEFAULTS = {"minSamples": 4, "runs": 10000, "horizon": 52, "prsPerStory": 1.0}
LEVELS = (("p50", 0.50), ("p85", 0.85), ("p95", 0.95))


def run(envelope, sdk):
    settings = {**DEFAULTS, **((sdk.settings.get("assumptions") or {}).get("forecast") or {})}
    basis = sdk.model().get("throughput")
    result = forecast(basis, settings, envelope["run"].get("seed", 1), sdk.window, sdk.model().get("grain"))
    sdk.write("forecast.json", result)
    return {"notes": [] if result["status"] == "ok" else [result["reason"]]}


def forecast(basis, settings, seed, window, grain):
    refused = reason_not_to(basis, settings)
    if refused:
        return {"status": "none", "reason": refused, "model": MODEL, "basis": describe(basis, settings)}
    need = basis["remaining"] * (settings["prsPerStory"] if basis.get("remainingUnit") == "stories" else 1)
    runs = simulate(samples(basis), need, int(settings["runs"]), int(settings["horizon"]), seed)
    sized = {**settings, "periodDays": basis.get("periodDays") or 7}
    return {"status": "ok", "model": MODEL, "seed": seed, "need": round(need, 2), **levels(runs, window, grain, sized), "basis": describe(basis, settings)}


def samples(basis):
    return [p["completed"] for p in basis["series"] if not p["partial"]]


# The first reason that holds is the one the page prints.
def reason_not_to(basis, settings):
    if not basis:
        return "nothing to forecast: this project has no backlog source (work items or planning documents) in this report"
    found = samples(basis)
    if len(found) < settings["minSamples"]:
        return f"only {len(found)} complete period(s) in the window; a forecast needs at least {settings['minSamples']}"
    if not any(found):
        return "nothing was completed in any complete period of the window, so there is no throughput to sample"
    return "nothing remains to forecast" if basis["remaining"] <= 0 else None


def simulate(found, need, runs, horizon, seed):
    rng = random.Random(seed)
    return [one_run(rng, found, need, horizon) for _ in range(runs)]


def one_run(rng, found, need, horizon):
    done, periods = 0.0, 0
    while done < need and periods < horizon:
        done += rng.choice(found)
        periods += 1
    return periods if done >= need else None


def levels(runs, window, grain, settings):
    ordered = sorted(runs, key=lambda n: float("inf") if n is None else n)
    finished = sum(1 for n in runs if n is not None)
    out = {"runs": len(runs), "horizon": settings["horizon"], "completedWithinHorizonPct": round(finished / len(runs) * 100, 1)}
    for name, q in LEVELS:
        n = ordered[min(len(ordered) - 1, int(q * (len(ordered) - 1)))]
        out[name] = {"periods": n, "endsOn": ends_on(window, settings["periodDays"], n) if n is not None else None, "beyondHorizon": n is None}
    return out


# Counted from the CUT-OFF: that is the moment the remaining work was measured.
def ends_on(window, period_days, periods):
    return (date.fromisoformat(window["cutoff"]) + timedelta(days=round(periods * period_days))).isoformat()


def describe(basis, settings):
    if not basis:
        return {}
    return {"unit": basis["unit"], "samples": samples(basis), "sampleCount": len(samples(basis)), "remaining": basis["remaining"], "periodDays": basis.get("periodDays") or 7,
            "remainingUnit": basis.get("remainingUnit", "items"), "prsPerStory": settings["prsPerStory"] if basis.get("remainingUnit") == "stories" else None,
            "assumptions": ["the near future resembles the sampled periods of this window",
                            "complete periods only; a period cut by the window's edge is not a sample"]
            + (["feature pull requests per story is an ASSUMPTION (settings.assumptions.forecast.prsPerStory), not a measurement"] if basis.get("remainingUnit") == "stories" else [])}
