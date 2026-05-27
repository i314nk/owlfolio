# Owlfolio Hybrid UI Direction Design

Date: 2026-05-27
Status: Draft for user review

## Summary

Owlfolio should use a hybrid UI model rather than a generic portfolio dashboard.

The approved product direction combines:

1. Operations Command Center as the home screen.
2. Research Dossier as the main detail screen for each company/research case.
3. Ledger Timeline as the trust/audit layer inside each research case.
4. Workflow Kanban later, after there are enough cases and recurring workflows to justify queue management.

This direction fits Owlfolio because the product is an autonomous, Shariah-by-design investment workflow system, not a holdings/charting app. The UI should make workflow state, user approval gates, strategy reasoning, and event auditability visible by default.

## Goals

- Make the next required user action obvious.
- Make each investment case readable as a durable case file.
- Make every provider/system/user action auditable from the UI.
- Keep demo mode understandable without credentials.
- Preserve the safety boundary that providers and workers draft analysis, but users approve state-changing investment decisions.
- Support the next architecture milestone: a durable local ledger that can replay projections.

## Non-goals

- Do not build a full trading dashboard.
- Do not lead with portfolio performance charts before durable ledger and workflow foundations exist.
- Do not make custom strategy creation a prominent main-UI workflow yet.
- Do not build Workflow Kanban immediately; defer it until Owlfolio has enough concurrent cases and recurring reviews.
- Do not add broker credential flows or trading actions in this phase.

## UI Model

### 1. Operations Command Center

The Command Center is the home screen.

Primary job:
- Answer: "What needs my attention now?"

It should show:
- System readiness: provider mode, strategy certification, Shariah status, ledger health.
- Pending user actions: research reviews, watchlist confirmations, monthly review items.
- Workflow counts: active research cases, watchlist drafts, pending approvals, stale monitoring items.
- Recent activity: latest ledger events or summarized workflow transitions.
- Links into the highest-priority research dossiers.

The Command Center should feel operational, not decorative. It is a cockpit for supervising autonomous workflows.

### 2. Research Dossier

The Research Dossier is the main detail page for a company/research case.

Primary job:
- Answer: "What does Owlfolio believe about this company, why, and what should I review?"

It should show:
- Company and ticker identity.
- Current workflow stage.
- Strategy verdict and reasoning.
- Buffett-Munger gate results.
- Shariah review status and any unresolved issues.
- Valuation status.
- Thesis summary.
- Source summary and evidence links.
- Draft decision state.
- Required user action.

The Dossier is the most important object page. It should be readable like an investment memo, but backed by structured events and projections.

### 3. Ledger Timeline / Audit Trail

The Ledger Timeline is a trust layer embedded inside each Research Dossier, either as a panel, drawer, or tab.

Primary job:
- Answer: "How did this state come to exist?"

It should show:
- Ordered ledger events for the research case.
- Actor type and actor ID for each event.
- Whether the event came from a user, provider, system, or worker.
- Payload summaries in human-readable form.
- Replay/projection status where relevant.
- Clear distinction between drafted recommendations and user-approved actions.

The audit layer should be accessible without overwhelming the default research reading experience. A collapsed timeline panel or tab is preferred over making raw events the default screen.

### 4. Workflow Kanban, Later

Workflow Kanban should not be part of the immediate next phase.

It becomes useful when Owlfolio has:
- many concurrent research cases,
- scheduled monitoring workflows,
- monthly review/accounting workflows,
- stale or blocked workflow queues,
- multiple user approval stages.

At that point, Kanban can provide an operational queue view across all cases. Until then, the Command Center plus Dossier model is simpler and more appropriate.

## Information Architecture

Near-term routes should evolve toward:

- `/` or `/command-center`
  - Operations Command Center.
- `/onboarding`
  - Demo/local setup entry.
- `/research/[caseId]`
  - Research Dossier.
- `/research/[caseId]/ledger` or in-page `ledger` panel/tab
  - Ledger Timeline for the case.
- `/watchlist`
  - Watchlist drafts and confirmed watchlist items.

A future Kanban route may be:

- `/workflows`
  - Cross-case workflow board.

## Data Flow

The UI should read from projections, not directly from ad hoc workflow state.

Expected flow:

1. Workflows append events to the durable local ledger.
2. Projections rebuild deterministic read models from ledger events.
3. The Command Center reads aggregate projection summaries.
4. Research Dossier reads one research-case projection plus related strategy/Shariah/source summaries.
5. Ledger Timeline reads the underlying ordered events for that case.
6. Watchlist views read watchlist projections.

This keeps the UI aligned with Owlfolio's auditability requirement.

## Durable Ledger Alignment

The next architecture milestone should be a durable local ledger. The UI design should support that milestone rather than distract from it.

A practical next phase should include:

- SQLite event store implementing the existing event-store contract.
- Seeded demo events stored durably for local/demo mode.
- Projection rebuild tests against durable events.
- Command Center reading from durable projection data.
- Research Dossier showing a ledger timeline from the same durable event stream.

This lets the UI demonstrate the core product promise: every visible conclusion can be traced back to events.

## Safety and Trust Requirements

The UI must preserve these semantics:

- Provider output is analysis, not approval.
- Worker/system output is draft workflow state, not user approval.
- User-approved actions must be visually distinct from drafts.
- Watchlist drafts created after user confirmation should show user actor attribution.
- Shariah status should be visible in the main research and command-center surfaces.
- Demo mode should not require credentials.

## Testing Strategy

Add or maintain tests for:

- Command Center displays readiness, counts, and pending user actions.
- Research Dossier displays strategy, Shariah, valuation, sources, next action, and ledger timeline entry points.
- Ledger Timeline displays ordered event actor attribution.
- Watchlist page distinguishes draft and user-confirmed states.
- Demo smoke test covers onboarding to command center to research dossier and verifies credential-free mode.
- Projection tests prove deterministic replay from the event store.

## Open Decisions

These should be decided during implementation planning:

1. Whether the Ledger Timeline appears as a right-side drawer, inline panel, or tab.
2. Whether `/` remains the Command Center route or redirects to `/command-center`.
3. How much visual polish to do before durable persistence.
4. Whether demo seeded events live in a SQLite fixture, migration, or explicit seed command.

## Recommended Next Milestone

Proceed with `v0.2 durable local ledger` before major UI polish.

Why:
- The current app proves the vertical slice, but demo state is still in code.
- A durable ledger makes auditability real.
- The Research Dossier and Ledger Timeline become much more meaningful when backed by stored events.
- Future autonomous workflows need persistent, replayable state before they grow more complex.

Recommended implementation order:

1. Add SQLite event store behind the existing event-store interface.
2. Add demo event seeding for local mode.
3. Add projection rebuild tests from SQLite-backed events.
4. Add ledger timeline projection/query for research cases.
5. Upgrade the Research Dossier to show the timeline/trust layer.
6. Update the Command Center to read projection summaries from the durable source.
