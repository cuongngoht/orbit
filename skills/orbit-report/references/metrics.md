# The standard metrics, the window, the forecast and the baseline

Every number a report prints is computed by a part from the run's frozen snapshot, as of the
cut-off. The definitions below are the declarations in `../parts.json` — the report prints
the same text beside each number, with its version.

## The window

| Asked | Window | Cut-off (the backlog is read here) |
|---|---|---|
| nothing (default) | the last **two complete calendar months** | the end of the last complete month |
| `--months=N` | the last N complete months | the end of the last complete month |
| `--as-of=D` | N complete months up to D | D |
| `--from=A --to=B` | A to B, in days | the end of B — "to date" when B is today |
| `--all` | everything the source holds | the end of the last complete month |

Run on 25 September: 1 July → 31 August, cut-off 31 August; September does not appear. A month
is complete once the cut-off has passed its last day, in the **project's** time zone (the
settings' `timezone`; the first run records the machine's). Months are counted from the 1st,
never as "60 days", so month ends and leap years are right, and the page is byte-for-byte the
same whichever zone the machine running it is in.

Rules every part follows:

- anything after the cut-off is not counted — a review, a merge, a comment, a deploy;
- a pull request merged in the window counts, whenever it was opened;
- a state at the cut-off is rebuilt from history (events, revisions); what a source keeps no
  history of — a review thread's resolution — is labelled "at capture", never "at merge".

## The standard metrics (`orbit.report.kpi.*`, version 1)

| Metric | Unit | Definition |
|---|---|---|
| Pull requests merged | count | Pull requests merged inside the window, whenever they were opened. |
| Merges per week | per week | Merged in the window ÷ the window's length in weeks. A pace proxy, not a deployment frequency. |
| Median cycle time | hours | Median open → merge hours over PRs merged in the window. |
| Cycle time, 85th percentile | hours | 85th percentile of open → merge hours. |
| Median lead time (PR proxy) | hours | Median first commit → merge hours. A PR proxy, not DORA's lead time for changes. |
| Median pickup time | hours | Median ready-for-review → first human review before the merge. |
| Median PR size | lines | Median lines added + deleted. Unknown — never zero — when the source does not report line counts (Azure Repos). |
| XL pull requests | % | Share with more than 1,000 lines changed, over the PRs whose size is known. |
| Human review before merge | % | Share with a review by someone other than the author, before the merge. Bots never count. |
| Approved before merge | % | Share with an approval before the merge. |
| Merged with threads unresolved at capture | % | Share with a thread unresolved when the data was collected — the source keeps no history of resolution. |
| Fix share (proxy) | % | Share classified as fixes from title or branch. Not a change-failure rate. |
| AI-authored commits (floor) | % | Share of commits whose author, committer or trailer carries a configured AI marker. A floor: AI work committed under a person's name is invisible. |
| Open pull requests at cut-off | count | Opened before the cut-off, neither merged nor closed at it. |
| Work items completed | count | Last move into a Completed-category state inside the window, still completed at the cut-off. One item linked to several PRs is one item. |
| Work items completed per week | per week | Completed in the window ÷ its length in weeks. |
| Median work item cycle time | hours | First In Progress-category move → completion. |
| Backlog at cut-off | count | Items in a Proposed, In Progress or Resolved category at the cut-off. Canceled (Removed) are excluded; states with no category are listed, never guessed. |
| Successful deployments per week | per week | Only when the source records deployments. |
| Build success | % | Succeeded ÷ (succeeded + failed + partially succeeded) finished builds. |

A **state** is whatever a team called it; what it means is the **category** its process gives
it (Azure Boards: Proposed, In Progress, Resolved, Completed, Removed). A custom state is read by
its category; a state no category claims is listed as unmapped and counted nowhere. On GitHub,
an issue closed as *not planned* is canceled, and a reopen is read from its events.

## Periods

The source's own iterations when at least two overlap the window (Azure Boards team
iterations, a GitHub Projects iteration field); else a cadence the settings name
(`mapping.iterations: { start, days }`); else calendar weeks. A period cut by the window's edge is
marked partial and never sampled as a whole one.

## The forecast (`orbit.forecast.mc/1`)

A Monte Carlo over what was completed per **complete** period of this window — never more
history than the window collected. It needs at least `minSamples` complete periods (default 4)
with at least one completion; otherwise there is no forecast, and the page says which rule
refused it. The work left is the backlog at the cut-off; dates are counted from the cut-off. A
percentile that falls on runs that had not finished by the horizon reads "beyond the horizon",
never a date. The seed comes from the run id, so a re-render reproduces the numbers; the seed,
the model, the sample and every assumption are printed with the result.

## The baseline

Compared only with an earlier run of the same source and scope (their identity hash), the same
kind and length of window, a cut-off before this one's, and — metric by metric — the same
definition version. Only rates, shares and medians are compared; a total depends on the window's
length and is shown side by side. Anything else is "not comparable", with the reason.
