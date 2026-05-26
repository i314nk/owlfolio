# Owlfolio v0.2 TypeScript Rewrite Design

Date: 2026-05-27
Status: draft for user review
Branch: `v02-typescript-rewrite`

## 1. Purpose

Owlfolio v0.2 is a clean TypeScript rewrite of Owlfolio as a polished, web-first, Shariah-by-design investment operating system. The current Python application remains the stable v0.1.x reference implementation. v0.2 should not be a line-by-line port. It should preserve the validated product ideas while simplifying the architecture around a workflow-centered web app, a hybrid memory ledger, provider-neutral research orchestration, and a certified Buffett-Munger strategy.

The product center is the full investment workflow, not chat:

Discovery -> Screening -> Research -> Shariah Review -> Valuation -> Decision -> Watchlist/Holding -> Monitoring -> Monthly Accounting -> Purification Ledger.

Chat remains useful as a contextual assistant, but it is secondary to the workflow UI.

## 2. Product Thesis

Owlfolio is a local-first investment workflow system that helps a user operate a disciplined, auditable, Shariah-conscious portfolio. It combines strategy-configurable research, autonomous monitoring, structured investment memory, provider-neutral AI research, monthly accounting, and purification tracking.

The app should feel like an operating dashboard for investment decisions, not a generic AI chat application.

### Core principles

1. Web-first product/demo.
   - The web UI is the primary interface.
   - CLI is secondary for developer/admin operations.

2. Shariah-by-design.
   - Shariah screening, compliance history, and purification accounting are first-class product concepts.
   - Shariah should not be an optional afterthought bolted onto generic research.

3. Buffett-Munger as the main certified strategy.
   - Buffett-Munger is the only fully certified strategy for the initial v0.2 release.
   - All other strategies are experimental until their hard gates, valuation methods, Shariah policy, compliance audit, and tests are complete.

4. Provider-neutral full workflow.
   - Owlfolio owns the workflow engine, research tools, memory ledger, validation, and audit layer.
   - Model providers supply reasoning through adapters.
   - Any officially supported provider must pass the full workflow certification suite.

5. Hybrid memory ledger over CRUD-first database thinking.
   - The app should think in terms of investment memory, ledger events, research cases, decisions, and current-state documents.
   - Durable storage can still use SQLite or another embedded store, but the domain model is not table-centric.

6. Setup must be incredibly easy.
   - A reviewer should get to a working local demo quickly.
   - A normal user should be guided through setup by a browser onboarding wizard.

## 3. Non-goals for v0.2 initial release

1. Broker trading integration.
   - No live trading, brokerage credentials, or order placement.
   - Broker/import integrations can be considered later.

2. Full parity for every experimental strategy.
   - Quality Compounder, GARP, 100-Bagger, Dividend Income, Deep Value, and Growth remain experimental until certified.

3. Blind support for arbitrary models.
   - The app can onboard multiple providers, but only certified providers are shown as fully supported.
   - Experimental providers may exist behind developer flags.

4. Enterprise multi-user SaaS.
   - v0.2 targets local-first/personal usage and a polished portfolio demo.

5. Recreating the Python architecture.
   - v0.2 should use the Python app as product reference, not as an architectural template.

## 4. Repository and rollout strategy

Start the rewrite in a clean branch:

- Branch: `v02-typescript-rewrite`
- Current Python `main` remains the stable v0.1.x reference.
- The rewrite can later replace `main` or move to a separate repository if the product name/positioning changes.

The v0.2 branch should begin with a clean TypeScript project structure rather than incremental edits to the Python source tree.

Recommended initial structure:

```text
apps/
  web/                 # primary web app
  worker/              # scheduled/autonomous task runner
  cli/                 # secondary CLI for admin/dev tasks
packages/
  core/                # investment domain services
  ledger/              # hybrid memory ledger and event store
  providers/           # model provider abstraction and adapters
  strategies/          # strategy policy schema and registry
  research/            # search/fetch/source-grounding tools
  shariah/             # screening and purification domain logic
  accounting/          # monthly accounting and performance snapshots
  shared/              # shared schemas/types
```

If using a full-stack framework, `apps/web` may contain both UI and API routes. The worker should remain separately runnable so scheduled tasks do not depend on a browser session.

## 5. Runtime model

v0.2 is a local Node application, not a serverless web app.

Runtime decisions:

- The primary app is a Next.js server running locally.
- The worker is a separate Node process using the same ledger API and app config.
- The durable store lives in a local app data directory, not in the repository.
- SQLite is the default durable store for the alpha unless the ledger spike proves another embedded store is simpler and safer.
- No serverless deployment target is required for v0.2 alpha.
- Browser onboarding writes local configuration through authenticated local API routes.
- Normal setup must not require manual `.env` editing.
- Provider credentials are stored in local configuration or OS keychain where feasible; secrets must never be committed to git.
- Web and worker share configuration through a single config module and must use ledger-level idempotency for concurrent/retried work.
- Background jobs are scheduled by the local worker, not by hosted cron infrastructure.

This model optimizes for a polished local demo and personal workflow. Hosted deployment and desktop packaging can be future milestones, but they should not complicate the v0.2 alpha.

## 6. v0.1 to v0.2 architecture reversals

The rewrite intentionally changes several v0.1 assumptions:

| v0.1 prototype | v0.2 target |
| --- | --- |
| Claude-only by design | Certified providers with full workflow parity |
| Agent SDK owns much of the loop | Owlfolio owns orchestration, tools, validation, and ledger writes |
| Synthesis owns the decision | Workflow engine owns gates; synthesis drafts conclusions |
| Prompt-first strategy YAML | Executable strategy policy contracts |
| Chat-centered web UI | Workflow-first command center |
| SQLite tables as product model | Ledger/projection API as product model |
| Shariah as useful add-on | Shariah-by-design domain model |
| Analyses as final text artifacts | Audited research cases with gate status, sources, and next actions |

These reversals are implementation constraints. If a v0.2 implementation recreates the v0.1 Claude/chat/table-centered architecture, it is off-track.

## 7. Recommended stack

Recommended starting stack:

- TypeScript
- Next.js for the primary web app
- React for UI
- Zod for schema validation
- Vitest for unit/integration tests
- Playwright for onboarding/workflow smoke tests
- SQLite or another embedded durable store under the memory ledger
- Drizzle only if a relational persistence layer remains helpful
- A separate worker process for scheduled tasks

Reasoning:

- Next.js gives the strongest web-first portfolio/demo presentation.
- TypeScript enables shared domain schemas between UI, API, worker, and providers.
- Zod makes provider output validation explicit.
- A separate worker keeps autonomous monitoring clean and testable.

## 8. Hybrid memory ledger

The missing heart of Owlfolio is the investment operating ledger.

Use a hybrid model:

1. Append-only events for audit-critical actions.
2. Current-state documents for fast app reads and agent context.
3. Source/citation records for research evidence.

The app should expose a ledger API rather than letting business logic directly manipulate database tables.

### Event examples

- company_discovered
- candidate_screened
- research_case_created
- specialist_finding_saved
- synthesis_completed
- shariah_status_updated
- valuation_completed
- decision_drafted
- decision_user_approved
- watchlist_item_created
- holding_opened
- holding_reviewed
- monthly_snapshot_recorded
- purification_obligation_created
- purification_payment_recorded
- scheduled_task_ran

### Current-state document examples

1. Strategy
   - policy contract
   - required specialists
   - hard gates
   - valuation method
   - Shariah rules
   - portfolio behavior

2. Company
   - ticker
   - market
   - currency
   - sector
   - latest price
   - data freshness

3. Research Case
   - ticker
   - strategy
   - status
   - workflow stage
   - assigned specialists
   - required data completeness
   - source coverage
   - open issues
   - synthesis verdict
   - stale date

4. Watchlist Item
   - ticker
   - strategy
   - buy zone
   - current price
   - gap to buy zone
   - thesis summary
   - next review trigger
   - priority

5. Holding
   - ticker
   - shares
   - cost basis
   - strategy
   - linked thesis/research case
   - position size
   - tranche status
   - current value
   - concentration impact
   - thesis health

6. Decision
   - buy/sell/watch/pass
   - linked analysis
   - reason
   - user-approved vs automated draft
   - timestamp

7. Accounting Snapshot
   - month
   - NAV
   - cash
   - invested value
   - deposits/withdrawals
   - realized/unrealized P&L
   - benchmark
   - source status

8. Purification Ledger Entry
   - ticker
   - ratio
   - source filing
   - dividend event
   - realized-gain event
   - purification owed
   - purification paid
   - remaining balance

## 9. Workflow-centered UI

The main UI should show the whole investment workflow in action.

Primary screens:

1. Command Center
   - portfolio status
   - pipeline counts
   - upcoming reviews
   - Shariah/purification alerts
   - provider/setup health
   - next recommended actions

2. Research Pipeline
   - discovered
   - screened
   - queued for deep dive
   - in research
   - draft complete
   - Shariah review
   - valuation review
   - decision pending
   - watchlist
   - holding
   - pass/rejected
   - stale/due for review

3. Research Case Page
   - company summary
   - strategy policy checklist
   - specialist findings
   - source coverage
   - hard gate status
   - Shariah status
   - valuation status
   - synthesis verdict
   - next required action

4. Watchlist
   - buy zone
   - gap to buy zone
   - thesis health
   - priority
   - stale review indicator

5. Portfolio
   - holdings
   - cost basis
   - current value
   - concentration
   - thesis health
   - review triggers

6. Shariah Compliance
   - current status by company
   - ratio history
   - filing/source basis
   - conditional/pending items

7. Purification Ledger
   - owed
   - paid
   - remaining balance
   - source filing and event linkage

8. Monthly Accounting
   - NAV snapshot
   - cash/invested split
   - deposits/withdrawals
   - realized/unrealized P&L
   - benchmark comparison
   - monthly audit report

9. Activity/Audit Log
   - append-only timeline of decisions, analyses, task runs, and ledger events

10. Provider and Setup Status
    - selected provider
    - auth status
    - certification status
    - model roles
    - missing setup items

Chat should appear as a contextual assistant panel, not the center of navigation.

## 10. Provider-neutral research engine

Owlfolio v0.2 should invert the current architecture.

Current Python prototype:

- Claude Agent SDK owns much of the agent behavior.
- Owlfolio wraps and coordinates it.

v0.2 target:

- Owlfolio owns the workflow, tools, source ledger, validation, memory writes, specialist orchestration, and audit requirements.
- Providers are interchangeable reasoning backends behind adapters.

### Provider requirements

Any certified provider must support the full Owlfolio workflow through native features or Owlfolio adapters:

- text generation
- structured output
- tool/function calling
- streaming or sufficiently observable long-running calls
- multi-step tool loop
- specialist research tasks
- synthesis
- source-grounded outputs
- Shariah review
- ledger update proposals
- scheduled task dry runs

Providers that cannot pass the certification suite may be experimental or unsupported, but they should not be presented as fully supported in normal onboarding.

### Initial provider targets

1. Claude
   - First certification target.
   - Can use Claude/Anthropic APIs or Claude Agent SDK if the adapter keeps Owlfolio, not Claude, as the workflow owner.

2. OpenAI
   - Second certification target.
   - Should support the same full workflow before being shown as certified.

3. Codex OAuth
   - Investigate as an auth path.
   - Do not assume Codex CLI is a stable embedded runtime.
   - If viable, integrate as an OpenAI auth option or Hermes-bridge option after a spike.

### Provider statuses

- Certified: passes full workflow certification.
- Experimental: visible only with explicit opt-in; not guaranteed for full workflows.
- Unsupported: not available in onboarding.

## 11. Provider certification suite

The certification suite is how Owlfolio keeps the promise that all supported providers can run all features.

Minimum tests:

1. Auth setup and status detection.
2. Simple completion.
3. Structured JSON output validated by Zod.
4. Tool call round-trip.
5. Multi-step tool loop.
6. Source-grounded research task.
7. Specialist parallel run.
8. Synthesis output.
9. Buffett-Munger strategy compliance audit.
10. Shariah review.
11. Ledger update proposal.
12. Scheduled task dry run.
13. End-to-end demo workflow from discovery to watchlist decision.

Certification should produce a readable report shown in developer docs and optionally in the UI.

## 12. Strategy system redesign

Strategies become executable policy contracts, not prompt presets.

A strategy must define:

1. Research lens
   - specialists
   - prompts
   - discovery brief
   - synthesis prompt
   - source hierarchy

2. Hard gates
   - blocking, warning, or informational requirements
   - examples: ROIC, FCF, leverage, dilution, Shariah status

3. Required data fields
   - data needed before synthesis can make a valid conclusion

4. Explicit valuation method
   - formula
   - assumptions
   - hurdle rates
   - margin of safety
   - bear/base/bull cases

5. Strategy compliance audit
   - which criteria passed
   - which failed
   - which are unknown
   - source evidence for each conclusion
   - whether valuation method was followed

6. Portfolio behavior
   - position sizing
   - sector exposure
   - review cadence
   - stale-analysis date
   - thesis-break triggers
   - add/trim/sell rules

7. Shariah policy
   - sector exclusions
   - financial ratio thresholds
   - non-compliant income thresholds
   - purification handling
   - filing/source requirements

### Strategy output separation

Every final research result should separately report:

- investment verdict: BUY, WATCH, PASS, RESEARCH_MORE
- strategy compliance: COMPLIANT, CONDITIONAL, NON_COMPLIANT, INSUFFICIENT_DATA
- Shariah status: COMPLIANT, CONDITIONAL, NON_COMPLIANT, UNKNOWN
- valuation status: ATTRACTIVE, FAIR, EXPENSIVE, INSUFFICIENT_DATA
- next required action

This prevents optimistic synthesis from overriding missing data or failed hard gates.

## 13. Buffett-Munger certified strategy

Buffett-Munger is the main strategy and first certified policy.

Required changes from current strategy files:

1. Hurdle rates
   - inevitable: 12%
   - monopoly: 13%
   - wide moat: 15%

2. Required specialists
   - Moat
   - Financials
   - Risk
   - Management
   - Valuation
   - Synthesis

3. Maintenance capex treatment
   - Move away from simple maintenance capex as percentage of total capex.
   - Use D&A-based and asset-intensity proxy logic where appropriate.

4. Moat analysis
   - Support business-model-specific moat weighting.
   - Do not assume network effects, brand, switching costs, cost advantage, and intangibles are equally relevant to every business.

5. Valuation discipline
   - Explicit owner-earnings/FCF valuation method.
   - Required bear/base/bull cases.
   - Required margin of safety.
   - Buy-zone calculation must be auditable.

6. Shariah policy
   - Shariah compliance is required by default.
   - Conditional status can block promotion until resolved.
   - Purification obligations must be tracked when relevant.

7. Portfolio behavior
   - concentrated style
   - max position size
   - initial/tranche rules
   - review cadence
   - stale-analysis date
   - thesis-break triggers

## 14. Experimental strategies

All non-Buffett-Munger strategies are experimental at v0.2 launch:

- Quality Compounder
- GARP
- 100-Bagger
- Dividend Income
- Deep Value
- Growth

Rules:

- Label clearly as experimental.
- Allow discovery and draft research where safe.
- Do not allow certified autonomous buy/sell decisions.
- Do not promote to certified portfolio operation until upgraded.
- Each must pass the strategy certification checklist before becoming certified.

Strategy certification checklist:

- hard gates
- required data fields
- explicit valuation method
- source hierarchy
- Shariah policy
- compliance audit
- portfolio behavior
- test fixtures
- sample passing and failing research cases

## 15. Shariah-by-design model

Shariah is a first-class domain, not a plugin.

Core components:

1. Sector/business activity screen
   - prohibited sectors
   - doubtful/conditional categories
   - source evidence

2. Financial ratio screen
   - debt threshold
   - cash/interest-bearing securities threshold
   - non-compliant income threshold
   - market-cap or asset-based denominator policy as configured

3. Compliance history
   - status over time
   - source filing
   - date of evidence
   - reason for changes

4. Purification ledger
   - dividend purification
   - realized-gain purification where applicable
   - owed/paid/balance
   - monthly roll-forward

5. Workflow integration
   - Shariah status affects research promotion, watchlist eligibility, holding review, and monthly audit.

## 16. Monthly accounting

Monthly accounting is part of the core workflow.

Required monthly snapshot fields:

- NAV
- cash
- invested value
- deposits
- withdrawals
- realized P&L
- unrealized P&L
- benchmark return
- strategy-level performance
- broker-confirmed vs estimated status
- purification owed/paid/balance
- audit notes

The monthly accounting workflow should produce a readable monthly report and append ledger events for audit.

## 17. Onboarding and setup

Setup must be simple enough for a GitHub reviewer and a future user.

Target developer flow:

```bash
git clone <repo>
cd owlfolio
pnpm install
pnpm dev
```

The browser should then launch or clearly display a local URL.

First-run onboarding wizard:

1. Choose mode
   - Demo mode with sample data
   - Personal local mode
   - Import from Python Owlfolio later

2. Connect provider
   - Claude
   - OpenAI
   - other certified providers as added

3. Run provider certification or quick readiness check
   - show auth source
   - show model roles
   - show certified/experimental status

4. Choose strategy
   - Buffett-Munger certified default
   - experimental strategies hidden behind advanced/discovery option

5. Configure Shariah defaults
   - enabled by default
   - show thresholds and assumptions

6. Configure market universe
   - non-broker discovery universe filter
   - no broker credentials required

7. Initialize memory ledger
   - create local durable store
   - seed demo data if selected

8. Start workflow
   - show command center with next best action

No normal setup path should require manual `.env` editing.

## 18. Migration from Python v0.1

Migration is useful but should not constrain v0.2 architecture.

Potential importers:

- holdings
- watchlist
- analyses
- specialist findings
- activity feed
- strategy YAMLs as references
- scheduled task history if useful

Migration should produce a report:

- imported records
- skipped records
- unsupported legacy fields
- warnings

## 19. v0.2 alpha/MVP vertical slice

The first implementation milestone must be a thin working path through the new architecture, not a broad partial rewrite.

Alpha goal:

A reviewer can run the local app, enter demo mode, inspect a Buffett-Munger research case, see strategy/Shariah/gate status, and promote the case to a watchlist draft through ledger events and projections.

Alpha scope:

1. Next.js app boots locally.
2. Demo mode works without external provider credentials.
3. SQLite-backed ledger exists with append-only events, versioned event envelopes, and rebuildable projections.
4. One workflow is implemented end-to-end:
   - create research case
   - run mocked or canned Buffett-Munger analysis
   - produce gate/status output
   - create decision draft
   - promote to watchlist draft with user confirmation
5. Shariah status is modeled as first-class and can be demo-seeded or manually entered.
6. Provider adapter interface exists.
7. A mocked provider passes provider contract tests.
8. Claude is the first real provider target, but broad provider work waits until the contract is proven.
9. Monthly accounting and purification ledger schemas exist, but full workflows can ship in a later milestone.
10. CLI is minimal and limited to health/dev/admin commands if needed.

Alpha exclusions:

- No live brokerage integration.
- No automated buy/sell approvals.
- No OpenAI certification until the provider contract and mocked-provider tests are stable.
- No full migration from Python before the ledger model stabilizes.
- No production desktop packaging.

## 20. Ledger contract and invariants

The ledger is the source of audit truth.

### Event invariants

- Events are append-only.
- Existing events are never edited or deleted through application logic.
- Corrections are represented by new correcting/reversing events.
- Projections are disposable and rebuildable from the event stream.
- Provider outputs cannot directly mutate current state; they create validated proposals or draft events.
- Portfolio-impacting final state changes require explicit user actor attribution unless an automation rule explicitly permits a low-risk draft transition.
- Every event handler must be idempotent.
- Every scheduled/provider run that can retry must include an idempotency key.

### Minimal event envelope

```ts
type LedgerEventEnvelope<TPayload> = {
  event_id: string
  event_type: string
  aggregate_type: 'strategy' | 'company' | 'research_case' | 'watchlist_item' | 'holding' | 'decision' | 'accounting_snapshot' | 'purification_entry' | 'provider_run' | 'scheduled_task'
  aggregate_id: string
  causation_id?: string
  correlation_id?: string
  idempotency_key?: string
  actor_type: 'user' | 'system' | 'provider' | 'worker'
  actor_id?: string
  payload: TPayload
  source_ids: string[]
  created_at: string
  schema_version: number
}
```

### Stable identity rules

- Tickers are not primary keys.
- Companies receive stable company IDs because tickers, listings, and markets can change.
- Research cases, decisions, holdings, accounting snapshots, and purification entries receive independent stable IDs.
- Market/ticker/currency live as attributes on company or instrument records.

### Evidence attachment

- Material research claims should reference one or more `source_ids`.
- Unsourced claims must be marked as unsourced or assumption-based.
- Source records include URL/file reference, retrieval time, title, publisher, extracted text hash, and trust classification.

## 21. Human approval and automation safety

Owlfolio is decision-support software. The automation boundary must be explicit.

Allowed AI/system actions:

- draft research cases
- classify candidate stages
- draft strategy compliance assessments
- draft Shariah assessments
- draft valuation outputs
- draft ledger update proposals
- create alerts and review reminders
- run scheduled research/monitoring tasks that produce drafts

Disallowed AI/system actions by default:

- mark a buy/sell decision as user-approved
- open or close a holding
- record an external transaction as final without user action
- mark purification as paid
- silently change Shariah policy
- silently promote a candidate into a portfolio-impacting state

Default approval rules:

- Buy/sell/pass/watch decisions are drafts until user-approved.
- Watchlist promotion requires confirmation in the certified default mode.
- Holding changes require manual user entry of an external transaction.
- Research schedules may create drafts and alerts, not final portfolio decisions.
- Every portfolio-impacting event must include actor attribution and an audit trail.

## 22. Legal and product boundary

Owlfolio is a local research, journaling, accounting, and audit-support tool.

It does not:

- provide personalized financial advice
- act as a registered investment adviser
- execute trades
- connect to a broker for order placement
- guarantee investment performance
- guarantee Shariah compliance as a scholarly ruling or fatwa

Outputs are decision-support drafts with audit trails. The user remains responsible for investment decisions, trade execution, source verification, and consultation with qualified financial or Shariah advisers where appropriate.

## 23. Provider execution sandbox and permissions

Provider calls run inside an Owlfolio-mediated execution context.

Rules:

- Providers receive scoped context, not unrestricted database access.
- Providers never write ledger events directly.
- Tool calls are mediated by Owlfolio and constrained by a per-run allowlist.
- Each provider run records model, provider, prompt/template version, tool allowlist, budget, timeout, and correlation ID.
- Provider outputs are validated by schemas and converted into proposals or draft events.
- Web-fetched content is untrusted and cannot alter tool permissions, system policy, strategy gates, or approval rules.
- Research tools return canonical source records with stable IDs.
- Portfolio/private data is redacted or minimized unless the task requires it.
- Case-scoped provider runs should not receive the full portfolio unless explicitly required.
- Tool calls must respect timeout, cancellation, rate-limit, and cost-budget controls.
- Retry behavior must use idempotency keys to avoid duplicate decisions, alerts, or ledger proposals.

Security tests must verify that providers cannot approve user decisions, bypass gates, or write directly to the ledger.

## 24. Shariah policy contract and versioning

Shariah policy is versioned and auditable.

A Shariah policy contract includes:

- policy_id
- policy_version
- standard_basis, such as AAOIFI, MSCI Islamic, or a user-defined policy
- sector exclusions
- doubtful sector handling
- financial ratio thresholds
- denominator rule
- non-compliant income threshold
- evidence requirements
- stale_after interval
- promotion rules for COMPLIANT, CONDITIONAL, NON_COMPLIANT, and UNKNOWN statuses
- purification calculation basis
- override rules and audit behavior

Every Shariah status must include:

- status
- policy_id and policy_version
- evidence date
- source filing/source IDs
- known fields
- unknown fields
- next required evidence
- stale date

Policy changes do not rewrite old rulings. They create new policy versions and new evaluation events. A company that was compliant under old evidence may become conditional, unknown, or non-compliant when new evidence or a new policy version is applied.

## 25. Testing strategy

Testing must cover both software correctness and investment workflow integrity.

Test layers:

1. Unit tests
   - strategy gate evaluation
   - valuation formulas
   - Shariah ratios
   - ledger event reducers
   - purification calculations

2. Integration tests
   - provider adapters
   - research tool calls
   - ledger writes
   - scheduled worker tasks

3. Provider certification tests
   - full workflow parity per certified provider

4. Strategy certification tests
   - Buffett-Munger passing and failing cases
   - compliance audit output
   - Shariah block/conditional behavior

5. End-to-end UI tests
   - first-run onboarding
   - demo workflow
   - research case progression
   - watchlist promotion
   - monthly accounting report


Additional required test categories:

6. Ledger replay tests
   - event stream -> projection state
   - projection rebuild after schema changes

7. Idempotency tests
   - duplicate provider/worker callbacks do not duplicate decisions, alerts, or ledger proposals

8. Golden research fixtures
   - known company cases with expected Buffett-Munger gate outcomes
   - passing, failing, insufficient-data, and conditional cases

9. Provider mock contract tests
   - fake provider exercises structured output, tool calls, retries, invalid JSON, and timeouts deterministically

10. Source-grounding tests
    - every material claim has a source_id or is explicitly flagged as unsourced/assumption-based

11. Migration snapshot tests
    - v0.1 SQLite fixtures import into expected v0.2 ledger events and projections

12. Authorization/safety tests
    - provider cannot write ledger directly
    - provider cannot approve user decisions
    - scheduled tasks cannot create final buy/sell approvals

13. Shariah policy versioning tests
    - policy changes create new evaluations without rewriting old rulings
    - UNKNOWN and CONDITIONAL statuses block or permit promotion according to policy

## 26. Kanban plan and milestone gates

Use a dedicated board for the rewrite:

`owlfolio-v02-typescript-rewrite`

Suggested epics:

1. v0.2 foundation/spec
2. project skeleton
3. hybrid memory ledger
4. workflow UI
5. provider-neutral engine
6. Buffett-Munger certified strategy
7. research workflow
8. Shariah-by-design
9. monthly accounting
10. experimental strategies
11. migration
12. release readiness

Kanban rules:

- Architecture/security/provider abstraction cards require review.
- No uncontrolled parallel coding before foundational interfaces are defined.
- Use final verification cards per milestone.
- Keep cards small enough for focused worker execution.
- Worker cards must declare dependencies explicitly.

### Milestone 0: Foundation decisions

Blocking decisions before implementation:

- runtime model
- package manager/workspace layout
- database/ledger technology
- event envelope
- projection rebuild strategy
- strategy contract schema
- provider adapter interface
- provider sandbox/permissions model
- human approval policy
- Shariah policy contract

### Milestone 1: Vertical demo skeleton

Deliverables:

- Next.js app boots locally
- SQLite ledger persists events
- demo data available
- command center renders
- research case projection works
- mocked provider executes deterministic workflow
- user can promote a demo research case to watchlist draft

### Milestone 2: Certified Buffett-Munger workflow

Deliverables:

- real Claude adapter
- Buffett-Munger gates
- valuation policy
- source ledger
- strategy compliance report
- provider certification report for Claude

### Milestone 3: Shariah + purification/accounting

Deliverables:

- Shariah policy contract
- compliance history
- purification events
- monthly accounting snapshot
- monthly report draft

### Milestone 4: OpenAI certification + migration

Deliverables:

- OpenAI adapter
- provider parity tests
- OpenAI certification report
- Python import report

## 27. Open decisions before implementation planning

1. Confirm Next.js vs Hono/Fastify + React.
   - Recommendation: Next.js for polished web-first portfolio/demo.

2. Confirm storage implementation.
   - Recommendation: embedded SQLite under a ledger/document API unless a simpler durable local document store proves sufficient.

3. Confirm provider certification order.
   - Recommendation: Claude first, OpenAI second, Codex OAuth spike before promising support.

4. Confirm naming.
   - Current decision: keep Owlfolio during v0.2 design; revisit rename later.

5. Confirm whether to push v0.1.1 before starting implementation.
   - Recommendation: push and tag v0.1.1 before substantial v0.2 coding.

## 28. Implementation readiness criteria

Implementation should begin only after:

1. This design is reviewed and approved.
2. The Kanban board is created.
3. Initial epics/cards are decomposed.
4. v0.1.1 is pushed or intentionally left local by explicit decision.
5. The first implementation plan is written for the project skeleton and core interfaces.
