# Owlfolio v0.2 command-center review CTA

## Goal
Make due/upcoming holding review prompts in Command Center point the user to the exact portfolio holding that owns the review action, without adding automatic scheduling or provider runs.

## Scope
- Add stable holding anchors to portfolio holding cards.
- Add per-prompt CTA links in Command Center review schedule cards that deep-link to `/portfolio#<holding_id>`.
- Keep the existing primary action as `/portfolio`; the per-prompt CTA removes ambiguity when multiple holdings exist.

## Out of scope
- Direct POST/run-review action from Command Center.
- Background scheduling, notifications, or automatic provider runs.
- Changing review cadence semantics.

## TDD checkpoints
1. Command Center component test: a review prompt renders `Review <ticker> in portfolio` with `href="/portfolio#<holding_id>"`.
2. Portfolio component test: holding cards render stable DOM ids matching the holding id so deep links land on the correct card.

## Verification
- Targeted: `corepack pnpm test -- apps/web/src/components/__tests__/CommandCenter.test.tsx apps/web/src/components/__tests__/ResearchWorkflowPages.test.tsx`
- Broader: `git diff --check && corepack pnpm typecheck && corepack pnpm test && corepack pnpm e2e`
