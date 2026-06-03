# Owlfolio v0.2 command-center review schedule

## Goal
Make confirmed or overridden holding `next_review_at` dates visible and actionable in Command Center without adding scheduler/background-worker complexity.

## Scope
- Project due/upcoming holding review prompts from ledger-backed holding state.
- Prioritize due reviews in `next_recommended_action` after pending user decisions and before generic holding monitoring.
- Render a compact Command Center schedule section with due/upcoming review prompts.
- Keep actions simple: send the user to `/portfolio`, where the existing “Run Buffett-Munger review” flow starts a fresh provider draft.

## Out of scope
- Background scheduling/cron.
- Automatic provider runs.
- Market/calendar integration.
- Notifications outside the web app.

## TDD checkpoints
1. Ledger projection test: confirmed review with `next_review_at` on/before `as_of` is due and becomes next action.
2. Ledger projection test: future `next_review_at` is upcoming but does not count as a pending user action.
3. Component test: Command Center renders Holding review schedule prompts and portfolio CTA.
4. E2E assertion: after review override/reject leaves `next_review_at: 2026-10-31`, Command Center shows an upcoming review prompt.

## Verification
- Targeted: `corepack pnpm test -- packages/ledger/src/__tests__/commandCenterProjection.test.ts apps/web/src/components/__tests__/CommandCenter.test.tsx && corepack pnpm e2e --grep "personal-local mode can create the first research case"`
- Full: `git diff --check && corepack pnpm typecheck && corepack pnpm test && corepack pnpm lint && corepack pnpm e2e && NODE_OPTIONS=--disable-warning=ExperimentalWarning corepack pnpm --filter @owlfolio/web exec next build`
