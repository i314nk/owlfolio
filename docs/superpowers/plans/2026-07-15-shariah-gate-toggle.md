# Shariah gate on/off toggle (owner-approved design, 2026-07-15)

Branch `shariah-gate-toggle` (stacked on `phase3-pillars` / PR #11). Wire the EXISTING
`config.shariah.enabled` flag end-to-end — today it is read by exactly one dashboard label and
nothing else, so setting it false would *say* "disabled" while every gate still enforces.

## Owner-locked rules

1. **Default ON.** Shariah-by-design is unchanged; this is an opt-out.
2. **Fail-visible, never fake-compliant.** With the gate off, transition gates still record a
   decision event — `allowed: true`, `status: 'DISABLED'`, a reason naming the setting — and the
   UI shows a neutral "GATE OFF" chip, never APPROVED. Names admitted while off are permanently
   labeled that way in the ledger; re-enabling never retroactively blesses them.
3. **Spend follows the switch.** Off = no Shariah front-gate provider call, no deep Shariah
   re-screen lane, and the quarterly `shariah_rescreen` worker task disabled (and re-based to ride
   `shariah.enabled` instead of the stale `purification.enabled`).
4. **Purification surfaces hide when off** (owner, 2026-07-15): the CONDITIONAL row lines on both
   boards AND the close-form exit-purification guidance. Render sites already carry
   "SHARIAH-OFF (queued setting)" markers.
5. **Mixed ledgers just work.** Admitted-while-off + re-enabled → the next analysis/re-screen gates
   normally; a FAIL flows into the existing grace → divest machinery. No new machinery.

## Slices (gates green per slice)

- **S1 — Settings + API.** `/api/settings/shariah` (POST, mirrors the automation route) writing
  `config.shariah.enabled`; a toggle card on the Settings page with honest copy (what OFF means).
  The command-center chip already reads the flag.
- **S2 — Gate honesty.** `evaluateResearchCaseShariahGate` early-returns a RECORDED decision when
  disabled (`status: 'DISABLED'`, allowed, reason names the setting). Chips (watchlist shariahChip,
  dossier gate section) render GATE OFF for that status. `assertShariahGateAllowsTransition` passes.
- **S3 — Swarm + worker spend.** `runStrategyResearchSwarm` skips the Shariah gate phase when off
  (analysis payload records `shariah_status: 'SCREENING_OFF'`-equivalent honestly); the deep
  Shariah re-screen lane is skipped; `shariah_rescreen` task `enabled` rides `shariah.enabled`
  (worker already loads app config).
- **S4 — Purification visibility.** Boards + close form receive the flag (page-level prop) and hide
  the CONDITIONAL lines + exit guidance when off. Dossier Shariah section states "screening was OFF
  for this run" on cases run while off.
- **S5 — Tests + e2e + docs.** Unit: gate-off decision recording, chip rendering, spend skip,
  worker task disable, purification hiding, mixed-ledger re-enable. E2e: toggle off → promote →
  GATE OFF chip → toggle on. Docs: CLAUDE.md boundary line, README, Learn/Strategy one-liners.
