# Owner's Manual v0.1.1 Product Boundaries

**Purpose:** v0.1.1 is a stabilization release. It should make Owner's Manual's existing product shape easier to understand, safer to run, and less surprising. It is not a feature-expansion track.

**Product stance:** Owner's Manual is a local, methodology-driven investment research notebook and portfolio monitor. It helps a human investor analyze companies, keep watchlists/holdings organized, run safe monitoring, and maintain an audit trail. It is not a broker, robo-advisor, trading bot, or automatic portfolio manager.

## Default experience

A fresh v0.1.1 user should see one clear path:

1. Use the Web UI or CLI to manage holdings/watchlists.
2. Use the `buffett-munger` strategy as the blessed default analysis methodology.
3. Run manual company analysis when the user asks for it.
4. Keep markdown reports, decisions, specialist findings, scheduled-task runs, and user-visible actions in the local audit trail.
5. Enable only safe no-LLM monitoring by default.
6. Leave Claude-powered research/discovery schedules disabled until the user explicitly opts in.

Default names to preserve:

- Strategy: `buffett-munger`
- Safe monitoring: enabled by default where setup creates schedules
- Research/discovery schedules: disabled by default
- Weekly discovery: opt-in only

## Boundary model

| Area | v0.1.1 status | Product rule |
|---|---|---|
| Manual company analysis | Core | A user can ask Owner's Manual to analyze a company/ticker and receive a persisted markdown report with reasoning and a BUY/WATCH/PASS style decision. |
| Markdown reports | Core | Analysis output should remain readable, durable, and easy to export/review outside the UI. |
| Holdings/watchlist CRUD | Core | Users can add, edit, remove, and inspect holdings/watchlist items locally. |
| Safe monitoring | Core default | Deterministic no-LLM checks, such as price/watchlist and portfolio/P&L refreshes, may be enabled by default. They must not silently fall back to Claude. |
| Audit trail | Core | Analyses, scheduled task runs, decisions, and noteworthy operations should be traceable after the fact. |
| Strategy YAML architecture | Core architecture | Keep strategies as YAML so methodology remains configuration rather than code. |
| `buffett-munger` | Blessed default | This is the recommended path for v0.1.1 onboarding, examples, docs, screenshots, and smoke tests. |
| Other strategy presets | Advanced opt-in | Keep them available for power users, but do not make first-run UX depend on choosing among many methodologies. |
| Addon infrastructure | Advanced/manual | Keep addon runners and registry infrastructure, but addons are explicit checks the user chooses. They are not part of the normal automatic analysis path. |
| Shariah/ESG/insider-style checks | Advanced/manual | Treat these as separate optional screens, not hidden default specialists. Disabled/unavailable addons should say so clearly. |
| Manual discovery/import | Advanced opt-in | Users can manually run discovery or import candidate lists when they want a pipeline beyond one-company analysis. |
| Scheduled discovery templates | Advanced opt-in | Keep disabled templates so the autonomous ladder is visible, but never enable research/discovery schedules by default. |
| Weekly discovery | Advanced opt-in | Weekly discovery is a template/cadence a user may enable after accepting cost/runtime implications. It is never a default. |
| Market universe toggle | Non-credentialed discovery setting | It means which public markets Owner's Manual may search, validate, and analyze. It does not connect to a broker. |
| Broker account sync | Deferred | No credentials, holdings sync, balances, orders, trade execution, or live broker APIs in v0.1.1. |
| Trading/order placement | Deferred | Owner's Manual may produce research and monitoring signals, but the user acts elsewhere. |
| Live broker APIs | Deferred | Avoid adding broker SDKs or credential flows in this stabilization track. |

## Terminology

### Core

"Core" means the default product surface a careful first-time user can rely on without accepting surprise cost, account-linking, or automation risk. Core features should be documented prominently and tested as the happy path.

Core v0.1.1 language:

- "manual analysis"
- "local reports"
- "holdings and watchlists"
- "safe no-LLM monitoring"
- "audit trail"
- "Buffett 4-Pillar default strategy"

Avoid implying that core Owner's Manual automatically researches, rebalances, or trades without explicit user action.

### Advanced opt-in

"Advanced opt-in" means useful existing infrastructure that should remain available but should not define onboarding. These features may cost Claude credits, take minutes/hours, or require the user to understand a specialized methodology.

Advanced opt-in v0.1.1 language:

- "strategy presets"
- "addon checks"
- "agentic discovery"
- "scheduled research templates"
- "batch analysis"

Advanced opt-in features must have explicit user initiation: a command, checkbox, schedule enable action, or imported list.

### Deferred

"Deferred" means intentionally outside v0.1.1. Docs and UI should not tease these as near-term defaults unless clearly marked as not supported.

Deferred v0.1.1 language:

- broker credentials
- broker account integration
- account/position sync from brokers
- live order placement
- trade execution
- robo-advisor automation

## Market universe is not broker integration

The market universe toggle is a non-credentialed research and discovery setting.

It answers:

- Which markets should discovery search?
- Which ticker formats should validation accept?
- Which markets are considered investable/searchable for analysis?

It does **not** answer:

- Which broker account is connected?
- Where does the user hold shares?
- Can Owner's Manual place trades?
- Can Owner's Manual sync balances, lots, orders, or transaction history?

Recommended label language:

- Good: "Analysis markets", "Research universe", "Searchable markets", "Discovery universe"
- Avoid: "Broker markets", "Connected markets", "Trading markets", "Account markets"

Recommended helper copy:

> Select the public markets Owner's Manual may search and validate for analysis. This does not connect a brokerage account or enable trading.

## Addons policy

Addons remain explicit specialist checks. They are useful when a user wants an extra lens, but they should not silently change the default research pipeline.

Rules:

1. Default analysis runs the selected strategy's normal specialist roster only.
2. Addons run only when manually selected or explicitly invoked.
3. Scheduled tasks should not add addon checks unless the schedule description names them.
4. Addon UI should distinguish available manual checks from unavailable/coming-soon checks.
5. Addon output should be stored with enough context to audit that it was an extra check, not the main strategy decision.

## Discovery and schedules policy

Discovery is valuable but expensive and agentic. v0.1.1 should keep it opt-in.

Rules:

1. Manual discovery (`owlfolio find`) remains available.
2. Candidate-list import remains available for users who already have their own screeners or watchlists.
3. Setup may create disabled research schedule templates.
4. Setup may enable safe no-LLM monitoring schedules.
5. Weekly discovery is a named opt-in cadence, not a default behavior.
6. UI copy for discovery/schedules should mention Claude cost/runtime before enabling recurring research.

This aligns with `docs/AUTONOMOUS_SCHEDULE_POLICY.md`: safe monitoring can run by default; Claude-powered research requires explicit opt-in.

## Strategy policy

The strategy YAML architecture stays. It is part of the core architecture because it keeps methodology readable and configurable.

v0.1.1 should, however, narrow the default path:

- Use `buffett-munger` as the blessed default and default examples.
- Keep other bundled presets as advanced options.
- Avoid forcing first-run users to choose among every strategy before they understand the product.
- Keep custom strategy creation for advanced users.
- Document strategy YAML as an implementation detail users can grow into, not a prerequisite for first success.

## Recommended README wording changes

These are documentation recommendations for a follow-up docs pass; v0.1.1 does not require feature code changes.

1. README hero/subtitle
   - Current direction emphasizes "automated" full lifecycle.
   - Recommended v0.1.1 wording: "A local, methodology-driven investment research notebook and portfolio monitor. Start with manual company analysis, markdown reports, watchlists, and safe no-LLM monitoring; opt into agentic discovery and scheduled research when you're ready."

2. Preset strategy wording
   - Current README says Owner's Manual ships with 7 preset strategies near the top.
   - Recommended: keep the fact, but add that `buffett-munger` is the default path and the rest are advanced presets.

3. Scheduled tasks wording
   - Keep the safe-vs-research split prominent.
   - Use "safe monitoring enabled by default; Claude research disabled by default" in Quick Start and Schedule sections.

4. Discovery wording
   - Prefer "manual discovery" and "opt-in scheduled discovery" over generic "automated sourcing" in first-run copy.

5. Broker/trading disclaimer
   - Add one concise sentence near portfolio/market copy: "Owner's Manual does not connect to brokers or place trades; portfolio data is local/manual in v0.1.1."

## Recommended UI wording changes

These are wording-only recommendations unless a follow-up task chooses to implement them.

1. Market dropdown
   - Rename or explain the existing market selector as "Analysis markets" or "Research universe".
   - Add helper copy: "Choose markets Owner's Manual may search and validate for analysis. This does not connect a broker or enable trading."

2. Add-ons dropdown
   - Rename header from only "Specialist Agents" to "Manual addon checks" or add helper copy: "Run only when selected; not part of default analysis."

3. Strategy selector
   - Mark `buffett-munger` as "Default" or "Recommended".
   - Group other presets under "Advanced presets" if the UI grows a grouped selector.

4. Schedule tab
   - Label safe tasks as "Safe monitoring / no Claude".
   - Label disabled templates as "Opt-in research / uses Claude".
   - For weekly discovery, use "Opt-in weekly discovery" rather than implying it is already active.

## Non-goals for v0.1.1

Do not add these as part of the stabilization track:

- Broker credential storage
- Account sync
- Order placement
- Trade execution
- Live broker APIs
- New strategy families beyond existing presets
- New addon categories unless required to simplify existing behavior
- New autonomous research defaults
- Auto-enabled weekly discovery

## Acceptance checklist

Before implementation work starts, any v0.1.1 change should answer yes to these questions:

- Does the default path still start with `buffett-munger`?
- Are safe monitoring tasks no-LLM and allowed to be enabled by default?
- Are Claude research/discovery schedules disabled unless the user opts in?
- Are addons explicit manual/advanced checks, not hidden default analysis steps?
- Does market-universe wording avoid broker/trading implications?
- Are broker credentials, account sync, order placement, and live broker APIs still deferred?
- Does the change simplify or clarify the current product instead of expanding scope?
