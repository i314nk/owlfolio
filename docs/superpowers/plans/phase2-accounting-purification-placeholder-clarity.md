# Phase 2: accounting and purification placeholder clarity

Kanban task: `t_ef182e35`

## Goal

Make the accounting and purification report pages honest, understandable, and product-quality without implying Owlfolio already models broker cash, deposits, withdrawals, fees, dividends, tax-grade accounting, or automatic purification payments.

## Acceptance criteria mapping

- Accounting summary labels cash/deposits/withdrawals/fees/dividends as placeholder, untracked, or projected/manual where appropriate.
- NAV and valuation freshness are explicit: NAV is projected from valued holdings plus placeholder cash, and incomplete/missing valuations are visible.
- Empty states show zero totals, next steps, and source/audit affordance previews instead of terse absence copy.
- Purification obligations and payments clearly separate owed/paid/remaining, user-recorded payment actions, and source/audit link previews.
- Projection data and fail-closed Shariah/accounting semantics are not changed.
- Component tests prove the placeholder/limitation labels are visible.

## Implementation checkpoints

1. RED: Extend `AccountingMonthlyReport` and `PurificationReport` component tests with expectations for honest placeholder labels, NAV/as-of freshness, empty states, and audit affordance previews.
2. GREEN: Update component copy/structure only; do not change projections or ledger helpers except, if needed, limitation copy.
3. Verify: run the two targeted component tests, `git diff --check`, typecheck, lint, and web build.

## Non-goals

- No broker sync, cash-flow ingestion, dividend ledger events, fee modeling, tax filing logic, or automatic payment marking.
- No changes to ledger projection semantics.
