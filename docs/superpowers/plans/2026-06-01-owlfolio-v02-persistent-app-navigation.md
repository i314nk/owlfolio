# Owlfolio v0.2 persistent app navigation

## Goal

Add a small persistent web navigation shell so users can move between the current first-class Owlfolio v0.2 areas without relying on page-specific back links or typed URLs.

## Scope

- Add navigation links for:
  - Command Center (`/`)
  - Research (`/research/new`)
  - Watchlist (`/watchlist`)
  - Portfolio (`/portfolio`)
  - Onboarding (`/onboarding`)
- Render the navigation from the root web layout so every app route inherits it.
- Keep route behavior and ledger semantics unchanged.
- Keep existing page CTAs/back links unless they conflict with the persistent shell.
- Add component-level and E2E coverage that verifies the nav is present and usable.

## Implementation steps

1. RED: add a layout rendering test that expects an accessible navigation landmark and all first-class route links.
2. RED: add a Playwright assertion that the persistent nav can move from Command Center to Watchlist and Portfolio.
3. GREEN: update the root layout to render a compact persistent nav before page content.
4. GREEN: adjust global/page spacing only as needed so the shell does not obscure content.
5. Verify targeted component and E2E tests, then run the full project verification command.

## Non-goals

- No auth/session-aware active route highlighting.
- No new route groups or state management.
- No changes to provider readiness, ledger writes, or workflow projections.
