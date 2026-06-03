# phase2 Command Center next-action UX polish

## Goal
Make Command Center read like Owlfolio's trustworthy operating console instead of a rough status page, while preserving the existing ledger-backed dashboard contract.

## Scope
- Keep the current design-system/app-shell checkpoint as the visual foundation.
- Improve Command Center rendering from the existing `AppCommandCenter` fields before changing ledger contracts.
- Add human-readable audit activity labels in the web layer while keeping event IDs visible.
- Add active navigation state for the global app nav.
- Fix the parent handoff's obvious contrast/readiness issues that affect this slice: light-surface secondary CTA readability and non-assertive global status-strip copy.

## TDD checkpoints
1. Add failing component tests for:
   - priority ordered actionable cards/CTAs for pending drafts, provider readiness, accounting, purification, and review schedule;
   - human-readable recent activity with audit event IDs preserved;
   - initialized zero-state copy and active navigation state.
2. Implement small UI helpers/classes in `CommandCenter` and navigation/design primitives.
3. Run targeted Vitest for Command Center/design system, then typecheck/lint/build.

## Acceptance mapping
- Direct actionable cards: `CommandCenter` renders a prioritized `Next action queue` instead of only repeating `dashboard.next_recommended_action`.
- Priorities: pending drafts and due reviews outrank setup/provider/accounting/purification informational cards; warnings are visually labeled.
- Human activity: event slugs become sentences like “Watchlist draft created” and include `event_id` as audit trace text.
- Zero states: personal-local empty state explicitly says the operating ledger has no events yet and points to first research.
- Navigation: `AppNavigation` marks the active route with `aria-current="page"` and an active class.
- Bloomberg accents: compact status/ticker strip, monospace IDs, dense action queue and metric grid without fake live trading claims.
