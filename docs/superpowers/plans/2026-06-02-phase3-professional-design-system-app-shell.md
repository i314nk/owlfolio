# Phase 3 Professional Design System and App Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development for behavior changes and superpowers:verification-before-completion before handoff. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the phase-2 dark shell into a reusable professional financial-console design foundation before page-specific polish lands.

**Architecture:** Preserve routes and domain behavior. Add cross-cutting design primitives and tokens in `apps/web/src/app/globals.css`, `apps/web/src/components/designSystem.tsx`, and the existing navigation/status badge components. Keep page-specific rewrites minimal; this checkpoint should give later page cards shared page-header, empty-state, source/audit-chip, status-badge, form-control, focus, and responsive shell affordances.

**Visual direction:** Linear-native dark shell; Coinbase/Stripe trust cues through conservative blue-violet accents, readable light-on-dark contrast, tabular numbers, and restrained source/audit metadata. Bloomberg influence is limited to compact data IDs/ticker/source chips, not orange trading-dashboard cosplay.

---

## Task 1: RED tests for phase-3 invariants

**Files:**
- Modify: `apps/web/src/components/__tests__/DesignSystem.test.tsx`

- [ ] Add tests that fail on the current tree for:
  - `AppShell` phase-3 marker and product-grade operating context chips (no debug-like “status shown below”).
  - `PageHeader`, `EmptyState`, and `SourceChip` reusable primitives.
  - Expanded status badge tones for certified/demo, experimental, blocked/unsupported, draft/pending, manual/untracked, and compliance.
  - CSS token/class invariants for focus-visible, custom select appearance, source chips, empty states, responsive nav, and shell status chips.
- [ ] Run the targeted DesignSystem test and confirm RED for missing exports/markup/classes.

Command:
`corepack pnpm test -- --run apps/web/src/components/__tests__/DesignSystem.test.tsx`

## Task 2: GREEN implementation of shared primitives and tokens

**Files:**
- Modify: `apps/web/src/components/designSystem.tsx`
- Modify: `apps/web/src/components/StatusBadge.tsx`
- Modify: `apps/web/src/app/globals.css`

- [ ] Update `AppShell` to use concise operating context chips and a phase-3 shell marker.
- [ ] Add typed React primitives:
  - `PageHeader` for title/eyebrow/description/actions.
  - `EmptyState` for reason + primary/secondary actions + optional provenance.
  - `SourceChip` for source/audit/event IDs with safe wrapping and optional href.
- [ ] Expand `StatusBadgeTone` while preserving existing `neutral|success|warning|danger` compatibility.
- [ ] Normalize CSS tokens/classes: focus-visible ring, dark selects (`appearance: none`), status palettes, empty states, source chips, compact responsive nav, and readable dark-shell surfaces.
- [ ] Rerun the targeted DesignSystem test until GREEN.

## Task 3: Focused integration and verification

**Files:**
- Same shared files as Task 2; page-specific adoption only if necessary to keep acceptance criteria honest without stealing child-card scope.

- [ ] Run targeted design-system test.
- [ ] Run related component tests that import shared primitives/status badges.
- [ ] Run `corepack pnpm typecheck`.
- [ ] Run `git diff --check` and inspect `git diff --stat` for unintended unrelated churn.

## Handoff expectation

This card changes code and should block as `review-required` after verified implementation. Include changed files, commands run, RED/GREEN evidence, and any deferred page-specific polish for child cards.
