# Owlfolio v2 Clean Sidebar, Onboarding, and Research Dossier Design

> **For Hermes:** Project-agent owns this product/design spec. Route implementation to code-agent through the Owlfolio v2 Kanban board.

**Goal:** Reduce Owlfolio v2 from a dense admin/debug-feeling interface into a clean, non-technical, automation-first local investment cockpit.

**Architecture:** Keep the existing local-first Next.js app and projection-driven workflow. Refactor the app shell and page information architecture so primary screens show only current state, next action, and concise decision evidence; move educational/provider/runbook detail into Learn/Docs or collapsed drawers.

**Tech Stack:** Next.js App Router, React createElement components, TypeScript, existing Owlfolio design-system components, Vitest, Playwright.

---

## Product decisions

### 1. Main navigation moves to the left sidebar

Recommendation accepted by user: replace the current top tab row with a permanent left navigation rail.

Rationale:
- Owlfolio is an investment operating system, not a small marketing/documentation site.
- The current top tabs create horizontal clutter and compete with page-specific actions.
- Left navigation is familiar for serious desktop workflow tools and scales better as surfaces grow.
- A left rail frees each page header to answer: what is the current state and what should the user do next?

Left rail items:
- Command Center
- Research
- Watchlist
- Portfolio
- Accounting
- Purification
- Audit
- Providers
- Learn
- Settings

Onboarding should not remain a normal permanent tab once setup is complete. It should appear as a prominent setup CTA/state when setup is incomplete, then collapse into Providers/Settings.

### 2. Onboarding becomes a non-technical guided setup flow

Current problem:
- The page exposes terms such as Codex CLI, setup-only, readiness, start blocked, and provider states too early.
- A non-technical local user should not need to understand CLI/provider certification language before seeing a clear path.

Desired UX:
- Command Center and sidebar show a large primary setup CTA when setup is incomplete: "Start setup".
- Onboarding page becomes a short wizard:
  1. Choose mode: "Try demo" or "Use my local AI assistant".
  2. Connect provider: "Connect ChatGPT/Codex" or "Connect Gemini" with plain-language readiness.
  3. Confirm ready: "Start using Owlfolio".
- Demo/local path remains the simple fallback: "Continue with demo mode".
- Provider/certification/CLI setup details move to Learn/Docs or collapsed advanced help.

Plain-language state examples:
- "Owlfolio cannot find your ChatGPT/Codex login yet."
- "You can keep exploring with demo mode while setup is incomplete."
- "Gemini sign-in can be detected, but Owlfolio cannot run the full workflow with Gemini yet."

Forbidden primary-surface copy:
- Raw "unsupported_surface"-style provider labels.
- Long CLI commands.
- Overclaims that real OAuth exists if it is only an OAuth-style/local-readiness UI.
- "Buffett-Munger certified" wording.

### 3. Primary pages follow a strict content hierarchy

Every main page should default to the minimum decision-critical view:
1. Current state.
2. Next best action.
3. One-line reason.
4. Key status/metric cards.
5. Primary user action, if any.
6. Links or drawers for evidence, audit, and details.

Move these out of the primary surface by default:
- Product explanations.
- Schema/ledger education.
- Runbook/backup/restore details.
- Raw event/stage tokens.
- Provider certification caveats unless blocking the current action.
- Repeated paragraphs.
- Long strategy explanations.

Destination for secondary detail:
- Learn/Docs pages.
- Collapsed "Why?" or "How this works" sections.
- Evidence drawer/right rail.
- Audit timeline drawer.

### 4. Research company pages become readable Research Dossiers

Current problem observed in MSFT case:
- The page has useful research, but it is displayed as repeated walls of text.
- The same thesis is copied into business, valuation, and Shariah sections.
- Raw workflow/status data competes with the actual investment decision.

Target layout:

Top dossier header:
- Ticker/company.
- Verdict pill: BUY/WATCH/PASS/RESEARCH_MORE.
- One-line verdict reason.
- Next required action.
- Primary action, e.g. "Promote to watchlist", only when user confirmation is appropriate.

Summary cards:
- Thesis: 2-4 bullets or a short paragraph.
- Valuation: status plus concise rationale.
- Shariah/compliance: status plus concise rationale and missing evidence if any.
- Risks/open questions: short bullets.

Evidence and audit:
- Human-readable source evidence is visible but not dumped across the full page.
- Raw source IDs remain available for audit, not as the primary evidence display.
- Ledger timeline moves to an expandable section or right-side evidence/action rail.

Dossier content rules:
- No duplicate fallback paragraph across multiple sections.
- If structured valuation/shariah/risk fields are absent, show a compact fallback summary once, then mark specific sections as "Needs structured detail" instead of repeating the whole thesis.
- Bullets first, long prose second.
- Hide raw internal tokens such as "decision_drafted" unless inside audit/advanced detail.

### 5. Right-side rail is contextual only

Do not move primary navigation to the right side.

Use right rail inside detail views for:
- Promote/add/confirm actions.
- Evidence/source links.
- Audit timeline access.
- Missing data checklist.

Do not use right rail for global app tabs; it is less familiar and conflicts with contextual evidence/actions.

## Implementation boundaries

In scope:
- App shell left sidebar and responsive behavior.
- Setup CTA/sidebar treatment for onboarding.
- Non-technical onboarding wizard copy and hierarchy.
- Research dossier layout/content deduplication.
- Page-level clutter reduction rules for major surfaces where low-risk.
- Tests and browser/e2e smoke around navigation, onboarding, and research dossier.

Out of scope:
- New real OAuth implementation.
- New provider adapter certification.
- Live trading/broker features.
- Full Settings/Data Safety expansion beyond existing boundaries.
- Broad rewrite of research/provider workflow internals unless needed to avoid repeated display fallback.

## Acceptance criteria

### Navigation/app shell
- Primary navigation is a left sidebar on desktop.
- Mobile/narrow layouts remain usable via responsive stacked/collapsed behavior.
- Active route is accessible and visibly clear.
- Top row no longer carries all primary app tabs.
- Sidebar includes setup status/CTA when onboarding is incomplete.
- Onboarding is not presented as a permanent peer tab after setup is complete unless still needed.

### Onboarding
- A non-technical user can start from Command Center with a single obvious setup button.
- Onboarding page reads like a guided setup flow, not a provider/debug console.
- Demo path remains clearly available and simple.
- Provider blockers are explained in plain language.
- Detailed CLI/provider/certification explanations are linked to Learn/Docs, not dumped on the primary page.
- Copy avoids overclaiming production OAuth or unsupported provider execution.

### General clutter reduction
- Primary pages expose current state, next action, concise reason, and essential status only.
- Long explanations and raw implementation details move to Learn/Docs, collapsed help, or audit detail.
- No raw workflow tokens appear in prominent primary page content unless explicitly labeled as audit/advanced detail.

### Research dossier
- `/research/rc_msft_1780826976000` no longer repeats the same MSFT thesis across multiple cards.
- The page shows a clean verdict summary, next action, thesis, valuation, Shariah/compliance, and risks/open questions.
- Source evidence is human-readable and available without making the page a wall of source cards.
- Raw source IDs and ledger timeline are still accessible for audit.
- "Promote to watchlist" remains a clear user-confirmed action, not an automatic state mutation.

### Verification
- Run and report:
  - `git diff --check`
  - `corepack pnpm typecheck`
  - `corepack pnpm test`
  - `corepack pnpm lint`
  - `PLAYWRIGHT_BROWSERS_PATH=/home/hermes_agent/.hermes/profiles/code-agent/home/.cache/ms-playwright corepack pnpm e2e`
- Browser smoke:
  - `/`
  - `/onboarding`
  - `/providers`
  - `/research`
  - `/research/rc_msft_1780826976000`
- Browser console should not show new runtime errors on smoke routes.

## Likely implementation files

Known relevant files from current inspection:
- `apps/web/src/components/AppNavigation.tsx`
- `apps/web/src/components/designSystem.tsx`
- `apps/web/src/app/globals.css`
- `apps/web/src/app/onboarding/OnboardingWizard.tsx`
- `apps/web/src/app/onboarding/page.tsx`
- `apps/web/src/components/ResearchCasePanel.tsx`
- `apps/web/src/app/research/page.tsx`
- `apps/web/src/app/research/[caseId]/page.tsx`
- `apps/web/src/components/__tests__/OnboardingWizard.test.tsx`
- `apps/web/src/components/__tests__/ResearchWorkflowPages.test.tsx`
- `apps/web/src/components/__tests__/ResearchPipelineCockpit.test.tsx`
- `apps/web/e2e/demo-mode.spec.ts`
- `apps/web/e2e/personal-workflow-intake.spec.ts`

## Recommended implementation decomposition

1. Card 1: App shell/sidebar and setup CTA.
2. Card 2: Non-technical onboarding wizard simplification.
3. Card 3: Research dossier redesign and content deduplication.
4. Card 4: Integration verification/checkpoint commit if prior cards leave a coherent dirty tree.

Because all code cards touch the shared web app, sequence them through Kanban parent links rather than running them concurrently.
