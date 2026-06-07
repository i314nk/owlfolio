# AAOIFI-aware purification calculation handoff

Kanban task: `t_90a8ebc8`
Audience: code-agent / product implementation
Date: 2026-06-05

## Executive summary

For Owlfolio, purification should be implemented as an auditable estimate/ledger workflow, not as an authoritative religious ruling or an automatic payment system. The safest default for public equities is a dividend-linked purification calculation: `purification_amount = cash_dividend_received * non_compliant_income_ratio`, where the ratio is sourced from the company filing / Shariah screening evidence for the same filing period.

Store the AAOIFI policy basis, policy version, evidence source IDs, filing period, dividend/holding period, ratio, amount, and user payment confirmation separately. Fail closed when required evidence is missing, stale, or ambiguous. Show the evidence and policy basis, then ask the user to confirm payment/resolution; do not label a purification obligation as paid unless there is a user-recorded payment event.

## Source-grounded policy basis

1. AAOIFI has a Shariah Standard SS (21), “Financial Paper (Shares and Bonds),” which is the relevant AAOIFI standard family for shares. AAOIFI's public page identifies the standard but does not expose the full standard text in the fetched public page.
2. Musaffa cites AAOIFI Shariah Standard No. 21, clause 3/4/6, as making it obligatory for Muslim investors to eliminate income derived from impermissible sources. Treat this as secondary-source evidence until the exact AAOIFI standard text is reviewed by the user/scholar.
3. Zoya describes its default standard as AAOIFI, says screening uses business activity plus financial screens, and says mixed permissible businesses commonly use a 5% threshold for impermissible revenue. Zoya also states AAOIFI financial screens include interest-bearing debt and interest-bearing assets not exceeding 30% of market cap.
4. Zoya's data cadence guidance: overall dataset refreshed daily for market structure changes; individual Shariah compliance reports refreshed in line with company reporting schedules, at least quarterly for US companies and semi-annually/annually for other reporters, with event-driven updates for significant business changes.
5. Zoya's purification help page says purification removes non-permissible income from stock investments and that there are several common methods depending on investment style/horizon.
6. Musaffa's practical stock-purification guidance says that for compliant stocks with impermissible income under the threshold, cash dividends are cleansed in proportion to the company's non-Shariah-compliant income percentage; example: if non-compliant income is 2% of total income, distribute 2% of the dividend to charity. It says capital gains from selling halal stocks generally do not need cleansing, because price changes do not directly reflect impermissible income/activity; special rules may apply if a stock becomes non-compliant.

## Recommended Owlfolio calculation policy

### Default calculation: dividend-linked purification

Use this default because it is the safest to implement with the data Owlfolio already expects to track and matches common product explanations from Zoya/Musaffa.

Formula:

```text
purification_ratio = non_compliant_income_ratio
purification_amount = dividend_income_amount * purification_ratio
```

Where:
- `dividend_income_amount` is the cash dividend actually received by the user for a holding.
- `non_compliant_income_ratio` is the company's impermissible / non-Shariah-compliant income ratio for the source filing period.
- `purification_ratio` should normally equal `non_compliant_income_ratio`, unless an explicit policy record overrides it.
- Round only at final money amount using the app's currency rounding convention; retain raw ratio precision in evidence fields.

Example:

```text
Cash dividend received: USD 40.00
Non-compliant income ratio: 0.05
Purification amount: USD 2.00
```

### Optional future policy: per-share/company-income method

Musaffa also describes a per-share method: total impermissible operations income during the year divided by shares outstanding, then multiplied by the investor's equity/shares. This is more data-intensive and should remain a separate policy option requiring scholar/product review before implementation.

Do not mix the two methods silently. Add a field such as `calculation_method` and make the method visible in the UI/audit trail.

## Required calculation inputs

### User/portfolio inputs

- `holding_id`
- `account_id` / broker or manual source identifier
- `ticker`, `exchange`, `company_name`
- share quantity held over the relevant period if using holding-period allocation
- `holding_period_start`, `holding_period_end`
- `dividend_event_id` when dividend-linked
- `dividend_income_amount`
- `dividend_currency`
- `dividend_received_at`
- optional tax/withholding fields if the app records gross vs net dividends; product/scholar review must decide whether purification uses gross or net dividend

### Company/Shariah evidence inputs

- `shariah_evaluation_id`
- `policy_basis` = `AAOIFI` initially
- `policy_version` / app policy version, e.g. `AAOIFI_SS21_APP_POLICY_2026_06`
- `standard_reference`, e.g. `AAOIFI SS 21` and, if verified, exact clause reference
- `non_compliant_income_ratio`
- `non_compliant_income_amount` if available
- `total_income_or_revenue_denominator`
- `source_filing_period_start`
- `source_filing_period_end`
- `source_filing_type` (`10-K`, `10-Q`, annual report, interim report, screener report, manual scholar-reviewed entry)
- `source_filing_date` / `published_at`
- `source_ids` for filings, provider reports, and analyst/scholar notes
- `evidence_summary` explaining how the ratio was derived
- `confidence` / `evidence_quality` (`provider_report`, `filing_derived`, `manual_review`, `unverified_secondary`)

### Calculation/result inputs

- `calculation_method`: recommended enum values:
  - `dividend_ratio`
  - `per_share_impure_income` (future/manual-review only)
  - `manual_override`
- `purification_ratio`
- `purification_amount`
- `currency`
- `period_start`, `period_end`
- `rounding_mode`
- `calculated_at`
- `calculated_by` (`worker`, `provider`, `user`)
- `reason`
- `policy_basis`, `policy_version`, `policy_source_ids`
- `requires_user_confirmation`
- `requires_scholar_review`
- `uncertainty_flags`

### User resolution/payment inputs

- `obligation_id`
- `payment_id`
- `paid_amount`
- `paid_currency`
- `paid_at`
- `recipient`
- `receipt_source_id` or user-entered note
- `resolution_status`: `unpaid`, `partially_paid`, `paid`, `overpaid`, `waived_by_user_policy_review`, `superseded`
- `user_confirmed_at`
- `user_confirmation_note`

## Recommended domain/event model changes

Existing `packages/ledger/src/projections/purificationProjection.ts` already supports:
- `obligation_id`
- `holding_id`
- `amount`
- `currency`
- `period_start`, `period_end`
- `reason`
- `shariah_evaluation_id`
- `accounting_snapshot_id`
- `dividend_event_id`
- `impurity_rate`
- user-recorded payment events

Recommended additions/renames for implementation clarity:

1. Rename or alias `impurity_rate` to `purification_ratio` in product/domain APIs. Keep `impurity_rate` only if backward compatibility is needed.
2. Add `calculation_method` to `PurificationObligationInput`.
3. Add source-period fields to the obligation payload:
   - `source_filing_period_start`
   - `source_filing_period_end`
   - `source_filing_type`
   - `source_filing_date`
4. Add policy/evidence fields:
   - `policy_basis`
   - `policy_version`
   - `standard_reference`
   - `policy_source_ids`
   - `evidence_summary`
   - `uncertainty_flags`
   - `requires_scholar_review`
   - `requires_user_confirmation`
5. Add calculation detail fields:
   - `dividend_income_amount` (already projected if linked to dividend event; consider also storing in payload snapshot for audit stability)
   - `ratio_source_id`
   - `rounding_mode`
   - `calculated_at`
   - `supersedes_obligation_id` for recalculations after filing/provider updates
6. Expand `purification_obligation_recorded` event contract payload fields in `packages/ledger/src/domainEventContracts.ts` beyond `['obligation_id', 'holding_id', 'amount', 'currency', 'period_start', 'period_end']` so audit-critical fields are declared.

## Recommended cadence

1. Dividend-triggered: when a `dividend_income_recorded` event is created, try to calculate an obligation using the latest compatible Shariah ratio for that holding/company.
2. Filing/provider-triggered: when a new 10-Q/10-K/annual/interim filing or provider Shariah report changes `non_compliant_income_ratio`, recalculate open/supersedable obligations whose source period is affected.
3. Quarterly default for US public companies: refresh Shariah/purification ratios at least once per quarter in line with SEC reporting cadence.
4. Semi-annual/annual default for non-US companies that report less frequently.
5. Event-triggered review: re-run when business model, major acquisition/disposal, delisting, split, ticker change, or compliance status changes.
6. Monthly UI/report rollup: show owed/paid/remaining by currency, but do not create obligations without dividend/company-ratio evidence unless a manual policy allows it.

## Fail-closed rules

Return `PENDING` / “needs review” rather than a calculated obligation when:
- no dividend/cash income event exists for dividend-linked method
- no sourced non-compliant income ratio exists
- ratio is outside `[0, 1]`
- ratio source period cannot be matched to the dividend/holding period
- policy basis/version is missing
- only secondary-source evidence exists for the AAOIFI clause and no user/scholar has accepted it
- dividend currency and obligation currency cannot be reconciled
- stock status is `NON_COMPLIANT` and sale/disposition policy, grace period, or capital-gain treatment is involved
- gross-vs-net dividend basis is unclear

## Safe UI/copy wording

Use wording like:

- “Estimated purification amount”
- “Based on Owlfolio policy: AAOIFI-aware dividend-ratio method”
- “Policy basis and evidence are shown for review. Owlfolio is not a religious, legal, tax, or financial adviser.”
- “Please confirm with your scholar/adviser if this policy applies to you.”
- “Record payment/resolution” rather than “Pay purification”
- “Marked paid only after user confirmation”
- “Evidence missing — calculation pending”

Avoid wording like:

- “This is the correct Islamic ruling”
- “Automatically paid”
- “Zakat” when referring to purification; keep zakat separate
- “Halal guaranteed”
- “No review needed”

## Uncertainty requiring user/scholar review

1. Confirm exact AAOIFI SS 21 clause text and whether the app's default formula should be dividend-linked, per-share impure-income, or another accepted methodology.
2. Confirm whether purification should use gross dividends, net dividends after tax withholding, or user-configurable basis.
3. Confirm treatment for capital gains from compliant stocks, stocks that become non-compliant, delayed sale/grace periods, and losses.
4. Confirm treatment of non-cash benefits: bonus shares, warrants, rights, spin-offs, DRIP reinvestments, and stock dividends.
5. Confirm whether purification obligations are calculated per dividend event, per reporting period, or annual rollup.
6. Confirm denominator definitions for `non_compliant_income_ratio`: total revenue, total income, segment revenue, or provider-specific methodology.
7. Confirm how to handle multiple screening providers/methodologies and conflicting ratios.
8. Confirm threshold behavior at exactly 5% and whether a ratio below the threshold still requires purification on dividends (secondary sources say yes).

## Implementation acceptance criteria for code-agent

- Add explicit policy/calculation method fields rather than hard-coding “AAOIFI” as enough.
- Support the dividend-linked formula and tests for `USD 40 * 0.05 = USD 2`.
- Require source IDs for dividend event, Shariah evaluation, source filing/provider report, and policy basis/version.
- Fail closed when ratio/policy/source period/dividend evidence is missing.
- Keep obligations and payments separate; payments are user events only.
- Add UI labels that this is an estimate and not religious/legal/tax/financial advice.
- Add source/audit display for filing period, ratio, calculation formula, and user confirmation state.
- Preserve current ledger projection semantics for owed/paid/remaining and extend payload fields without breaking existing tests.

## Sources

- AAOIFI, “SS (21) Financial Paper (Shares and Bonds)” public standard page: https://aaoifi.com/ss-21-financial-paper-shares-and-bonds/?lang=en
- Zoya Help Center, “How does Zoya screen stocks for Shariah compliance?”: http://help.zoya.finance/en/articles/4189798-how-does-zoya-screen-stocks-for-shariah-compliance
- Zoya Help Center, “How often does Zoya update compliance data?”: http://help.zoya.finance/en/articles/4189811-how-often-does-zoya-update-compliance-data
- Zoya Help Center, “How do I calculate purification?”: http://help.zoya.finance/en/articles/8387373-how-do-i-calculate-purification
- Musaffa Academy, “Stock Purification: 5 Ways How to Purify Your Stock Investment”: https://academy.musaffa.com/stock-purification-5-ways-how-to-purify-your-stock-investment/
- Musaffa Academy, “How to Purify Halal Stock Investment”: https://academy.musaffa.com/how-to-purify-halal-stock-investment/
- Musaffa Academy, “Why Should You Purify Your Investment?”: https://academy.musaffa.com/why-you-should-purify-your-investment/
- Musaffa Academy, “The Importance of Purification in Halal Investing”: https://academy.musaffa.com/the-importance-of-purification-in-halal-investing/
- Musaffa Academy, “2 Crucial Things What Every Muslim Must Know About Purification”: https://academy.musaffa.com/purification-process-tips-you-should-know/
