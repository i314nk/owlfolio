# Phase 2 Professional Design System and App Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish Owlfolio's phase-2 product UI foundation with a reusable dark professional design system and global app shell.

**Architecture:** Keep domain behavior unchanged and move visual vocabulary into reusable app-level primitives: CSS custom-property tokens in `apps/web/src/app/globals.css`, typed React primitives in `apps/web/src/components/designSystem.tsx`, and global shell/navigation wiring in `RootLayout`. Existing pages can opt into primitives gradually; this checkpoint applies them to the shell, navigation, status pills, and Command Center metrics as the first reusable surface.

**Tech Stack:** Next.js App Router, React `createElement`, TypeScript, Vitest server-side rendering tests, CSS custom properties.

---

## Design spec

### Visual direction
- Linear-inspired dark product shell: `#07080d` page canvas, `#0d111a` sidebar/header panels, translucent elevated cards, fine white-alpha borders, restrained luminance-based depth.
- Stripe/Coinbase trust cues: deep navy/blue-violet accent range, conservative status colors, tabular financial numerals, clean card geometry, no speculative trading visual language.
- Bloomberg accents only where useful: compact status strip, monospace/ticker labels, command/search affordance, dense market-data cards. Avoid orange/neon clutter.

### Color tokens
- Canvas: `--owl-color-canvas: #07080d`
- Shell: `--owl-color-shell: #0d111a`
- Panel: `--owl-color-panel: rgba(255,255,255,0.035)`
- Elevated panel: `--owl-color-panel-elevated: rgba(255,255,255,0.06)`
- Border: `--owl-color-border: rgba(255,255,255,0.08)`
- Border strong: `--owl-color-border-strong: rgba(132,145,255,0.28)`
- Text primary: `--owl-color-text: #f7f8ff`
- Text secondary: `--owl-color-muted: #9aa4b7`
- Text quiet: `--owl-color-quiet: #687085`
- Accent: `--owl-color-accent: #6366f1`
- Accent bright: `--owl-color-accent-bright: #7c8cff`
- Finance blue: `--owl-color-finance-blue: #0a84ff`
- Shariah green: `--owl-color-shariah: #22c55e`
- Warning amber: `--owl-color-warning: #fbbf24`
- Risk red: `--owl-color-risk: #ef4444`

### Typography
- Primary stack: Inter/system sans with `font-feature-settings: "cv01", "ss03"`.
- Mono/data stack: JetBrains Mono/system monospace for tickers, command affordances, audit IDs, and financial labels.
- Display headings use tight line-height and negative tracking; body text stays calm and readable.
- Financial values use `font-variant-numeric: tabular-nums` and right-aligned/mono-friendly class support.

### Spacing and radius
- 8px base grid: 4, 8, 12, 16, 24, 32, 48.
- Radius: 6px controls, 10px compact cards, 16px panels, 999px pills.
- Max content width: 1180px.
- Responsive shell collapses from side-by-side brand/nav/status composition into wrapped rows without hiding primary routes.

### Component inventory for this checkpoint
- `AppShell`: dark global shell with persistent nav, Bloomberg-inspired status ticker, and main content region.
- `AppNavigation`: dark precision nav with product mark, route pills, and command/search affordance.
- `OwlCard`: reusable elevated panel/card primitive.
- `OwlButtonLink`: primary/secondary/danger link/button visual primitive for existing href actions.
- `StatusBadge`: reusable status pill with neutral/success/warning/danger tones.
- `FinancialNumber`: tabular number display for Command Center metric values.
- CSS focus states: `.owl-focusable:focus-visible` ring with visible outline and box-shadow.

---

### Task 1: Plan and RED tests

**Files:**
- Create: `docs/superpowers/plans/2026-06-02-phase2-professional-design-system-app-shell.md`
- Create: `apps/web/src/components/__tests__/DesignSystem.test.tsx`
- Modify: `apps/web/src/components/__tests__/CommandCenter.test.tsx`

- [x] **Step 1: Save this design spec/plan.**
- [ ] **Step 2: Add failing tests for shell, nav command affordance, status pills, and financial numerals.**
- [ ] **Step 3: Run targeted Vitest command and confirm RED due to missing design-system exports/markup.**

Run: `corepack pnpm test apps/web/src/components/__tests__/DesignSystem.test.tsx apps/web/src/components/__tests__/CommandCenter.test.tsx`
Expected: FAIL because `AppShell`, `FinancialNumber`, and/or new shell markers do not exist yet.

### Task 2: Tokens and reusable primitives

**Files:**
- Create: `apps/web/src/app/globals.css`
- Create: `apps/web/src/components/designSystem.tsx`
- Modify: `apps/web/src/components/StatusBadge.tsx`

- [ ] **Step 1: Add CSS custom-property tokens, shell/card/button/badge/form/financial-number classes, focus-visible states, and responsive nav rules.**
- [ ] **Step 2: Add React primitives using `createElement`: `AppShell`, `OwlCard`, `OwlButtonLink`, `FinancialNumber`.**
- [ ] **Step 3: Update `StatusBadge` to use the status-pill token classes while preserving existing `tone` props and text behavior.**
- [ ] **Step 4: Run targeted tests and confirm GREEN for new primitive tests.**

### Task 3: Global shell/navigation and first page adoption

**Files:**
- Modify: `apps/web/src/app/layout.tsx`
- Modify: `apps/web/src/components/AppNavigation.tsx`
- Modify: `apps/web/src/components/CommandCenter.tsx`

- [ ] **Step 1: Import `globals.css` and wrap `children` in `AppShell` from `RootLayout`.**
- [ ] **Step 2: Redesign `AppNavigation` with dark precision nav, route pills, and command/search affordance while preserving hrefs and aria label.**
- [ ] **Step 3: Apply `OwlCard`, `OwlButtonLink`, and `FinancialNumber` to Command Center metrics and action panel only; preserve dashboard text, hrefs, and conditional behavior.**
- [ ] **Step 4: Run focused Command Center tests.**

### Task 4: Verification and checkpoint

**Files:**
- All changed files above.

- [ ] **Step 1: Run `git diff --check`.**
- [ ] **Step 2: Run `corepack pnpm test apps/web/src/components/__tests__/DesignSystem.test.tsx apps/web/src/components/__tests__/CommandCenter.test.tsx`.**
- [ ] **Step 3: Run `corepack pnpm typecheck`.**
- [ ] **Step 4: Run `corepack pnpm lint`.**
- [ ] **Step 5: Run `NODE_OPTIONS=--disable-warning=ExperimentalWarning corepack pnpm --filter @owlfolio/web exec next build`.**
- [ ] **Step 6: Inspect `git diff --stat` and commit one coherent checkpoint if verification passes.**
