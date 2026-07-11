# Plan: Book alignment — "The New Money Strategy" refinements (Phase 4)

## Context

Owner directive (2026-07-11): the app should mimic the book's strategy; the Shariah gate stays.
Phase 3 (4-pillar restructure, PR #11) already delivers the skeleton: circle gate + understand lane
(10-K-first), the moat taxonomy + three tests as the anchor, the management pillar (integrity
communication/comp + talent ROIC/payout/debt + retained-earnings test + veto), rules 4–6 as the
pipeline gates, quarterly re-review as the check-in routine. This phase refines the deltas and adds
the passive sleeve. Branch: continue on `phase3-pillars` (stacked) or a new branch off it after
PR #11 review — owner merges #10 → #11 first.

## Owner decisions (locked 2026-07-11, second session)

- **Valuation basis: FCF primary, OE sanity.** Current FCF = CFO − capex (new XBRL: cash from
  operations), grown 10 years at the judged growth. The owner-earnings bridge stays computed as a
  CROSS-CHECK with a divergence flag — it no longer drives the buy threshold.
- **Discount: flat 15% required return as the DEFAULT, user-changeable in Settings** ("anything
  less, buy the index" — it doubles as the active-vs-passive hurdle). New `required_return` setting
  (like the savings-anchor setting); the savings anchor REMAINS for the deployment hurdle/sizing.
- **Margin of safety: 30% buy / 50% load-the-truck.** Buy zone arms at a 30% discount to intrinsic
  value (rule 7); a 50% discount marks the LOAD-UP zone (rule 8) and drives concentrated sizing.
  Replaces the uniform 25%.
- **Terminal value: model-judged industry P/FCF exit multiple**, cited-or-labeled (peer-standout
  pattern), harness-clamped to a sane band (8–20×), conservative fallback (12×?) when ungrounded.
  Replaces terminal-growth perpetuity; year-10 FCF × exit multiple.
- **Net cash/debt adjustment**: add cash & equivalents, subtract total debt (book step 5) — fields
  already extracted.
- **Two-engine strictness**: book-faithful — margins must be EXPANDING (slope > +25bps/yr) for the
  engine; add the four-quadrant diagnostic (both_engines / margin_only_cutting_back /
  revenue_only_buying_growth / neither). Note: CE=2 alone still anchors moderate, so a stable-margin
  compounder is not anchor-punished.

## Slices

### B1 — XBRL FCF + balance-sheet foundations (gating; mirrors Phase 3 S1)
secEdgar: `cfo` (['NetCashProvidedByUsedInOperatingActivities', 'NetCashProvidedByOperatingActivities'
precedence], IFRS 'CashFlowsFromUsedInOperatingActivities'), `current_assets` (['AssetsCurrent']),
`current_liabilities` (['LiabilitiesCurrent']) → optional AnnualFacts fields `cfo_musd`,
`current_assets_musd`, `current_liabilities_musd`. Helper `yearFcf` (cfo − capex) in annualRatios.
Fail-closed like gross profit.

### B2 — Book valuation mechanics
- New settings: `required_return` (default 0.15) — Settings panel + /api/settings route + threading
  (mirror risk_free_rate F.2 threading to web-inline/worker/resume paths).
- valuationParams: `required_margin_of_safety: 0.30`, `load_up_margin: 0.50`, exit-multiple band
  + fallback constants.
- Valuation stage schema += `industry_exit_multiple { multiple, basis_note, citation? }` (cited-or-
  labeled); harness clamps to band, falls back when ungrounded.
- Harness valuation: intrinsic value = Σ discounted FCF(1..10) + discounted(FCF10 × exit multiple),
  + cash − debt, ÷ diluted shares → per-share IV. Computed buy threshold = IV × (1 − 0.30);
  `load_up_below = IV × (1 − 0.50)`; `in_load_up_zone` T0. OE bridge → `oe_vs_fcf_divergence` flag
  (advisory). Sanity rails re-pinned (implied growth vs FCF base, exit multiple sanity vs the model's
  own judged multiple). Dossier: both thresholds + zone chips; LOAD-UP renders distinctly.
- Sizing: rule 8 — the sizing recommendation escalates toward the full moat-tier weight when
  in_load_up_zone (design the mapping; keep max_position_weight caps).

### B3 — One-pager (understand lane structured output)
UnderstandLaneSchema: `one_pager { plain_english (one sentence), segments[], revenue_drivers[],
most_profitable_segments[], strengths[], weak_spots[], growth_levers[] }` retry-forced; cite-gated
where claims are filing-backed. Dossier P1 card "The one-pager". Legacy prose lanes tolerated.

### B4 — Management book refinements
- Integrity prompt: the five candor questions verbatim (jargon-hiding, openness about challenges,
  responsibility vs blame, leader vs politician, trust more/less) + steer to Part I Item 1 and
  Part II Item 7 (MD&A) via the existing read_source Items.
- Talent T0 debt block: += debt_to_equity (<1 conservative / >2 warning) + current_ratio (≥2 healthy /
  ≥1 ok / <1 red flag) from B1 fields; keep interest coverage.

### B5 — Two-engine strictness + quadrant diagnostic (moatTests + anchor + dossier re-pin)

### B6 — Sell rules + check-in copy
Sell-decision/holding-review prompts structured around rules 10–13 (rotten→sell, changed→ok to
leave, far-above-IV→lock profit, great-stays-great→hold; emit which rule applies). Re-review copy
notes the quarterly rhythm. Rule 9 line in the synthesis prompt (don't demand every box).

### B7 — Passive sleeve (new domain, design-first)
Settings: split (80/20 | 60/40 | 100/0), monthly amount, schedule day; user-authored
`passive_contribution_recorded` events; a Passive panel (plan vs recorded, next due, rules 1–3 copy,
"lifelong commitment — no sell affordance"); split-drift view vs active holdings. Worker observation
reminder (dry-run-safe). Needs a small design pass before build.

### B8 — Verification + live acceptance (offline gates + a live FCF-valuation run; check the 15%/30%
buy threshold against hand math; LOAD-UP zone probe; one-pager + candor output quality).

## Notes
- kimi HOLD→PASS verdict-vocabulary calibration: fold into B2's prompt touch (fair-value HOLD = WATCH).
- Peer-filing fetching (standout → scored anchor component) stays future work.
