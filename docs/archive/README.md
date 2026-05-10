# Archived docs

These files describe earlier phases of Owlfolio's design. They're kept
for historical reference — for current behavior, see the active docs in
`../`.

| File | Phase | What it covered | Why archived |
|---|---|---|---|
| [`PHASE_1.md`](PHASE_1.md) | Phase 1 (MVP) | Original plugin pipeline (EDGAR + formula evaluator + mechanical decisions). | Replaced by the specialist subagent architecture in Phase 3a. The `edgar.py` / `valuation.py` / `decision.py` modules it describes are deleted. |
| [`PHASE_1_5.md`](PHASE_1_5.md) | Phase 1.5 | Hardening of the plugin pipeline (logging, structured outputs, error isolation). | The pipeline it hardened was replaced. Hardening *patterns* carry forward in the new architecture. |
| [`PHASE_2.md`](PHASE_2.md) | Phase 2 | SQLite persistence + portfolio + Finviz screening + daemon. | Persistence + portfolio + daemon are still current. The Finviz screener was removed and replaced by the agentic-discovery + import pipeline (see `../ARCHITECTURE.md`). |
| [`BUGS_AND_VALIDATION.md`](BUGS_AND_VALIDATION.md) | Phase 1.5 | Bug log for the plugin pipeline + early validation pass. | All bugs fixed; the code they affected has been deleted. Pure historical record. |
| [`FLAGS.md`](FLAGS.md) | Phase 3a/b | Audit flags from the strategy YAML review (April 2026). | All flags resolved. The convention they pinned (free-form tier names per strategy) is now in `../STRATEGY_GUIDE.md`. |
| [`SPECIALIST_TUNING.md`](SPECIALIST_TUNING.md) | Phase 3a/b | Audit + tunings of all 35 specialist prompts. | Tunings applied during the 2026-04 two-zone restructure — see the banner inside the file for the mapping to current strategy YAMLs. |

If you're trying to understand *why* the codebase looks the way it
does, this archive is the right place. If you're trying to figure out
*how the system works today*, ignore this folder and read the active
docs.
