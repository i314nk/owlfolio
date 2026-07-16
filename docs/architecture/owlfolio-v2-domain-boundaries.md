# Owner's Manual v2 domain and route boundaries

This contract slice freezes the small domain/event surface that downstream parallel lanes can build on. It is intentionally a boundary document, not a feature-complete implementation plan.

## Event families

All events use the shared `LedgerEventEnvelope` shape with `schema_version: 1`, stable `event_id`, `aggregate_type`, `aggregate_id`, `actor_type`, optional causation/correlation IDs, `source_ids`, and a typed payload. The canonical TypeScript source is `packages/ledger/src/domainEventContracts.ts`.

| Family | Events | Aggregate | Projection owner | Notes |
|---|---|---|---|---|
| Scheduled task | `scheduled_task_defined`, `scheduled_task_run_started`, `scheduled_task_run_completed`, `scheduled_task_run_failed` | `scheduled_task` | worker status | Worker lanes append run lifecycle events; UI reads status only. |
| Provider run | `provider_run_started`, `provider_run_completed`, `provider_run_failed` | `provider_run` | provider status | Provider/model/task metadata belongs on every run. Provider output domain decisions remain proposal-before-write. |
| Certification report | `certification_report_recorded` | `provider_run` | provider status | Support labels must not exceed the latest report and actual adapter capabilities. |
| Shariah | `shariah_evaluation_recorded`, `shariah_status_changed` | `holding` | Shariah status | Provider can draft/evaluate; user-authored overrides/status changes remain explicit events. |
| Purification | `purification_obligation_recorded`, `purification_payment_recorded` | `purification_entry` | purification | Obligation and payment are separate auditable transitions. |
| Accounting | `accounting_snapshot_recorded` | `accounting_snapshot` | accounting | Monthly NAV/cash/position snapshots are worker-authored. |
| Cash | `cash_deposited`, `cash_withdrawn` | `cash_account` | accounting | Manual cash movements are user-authored until broker sync exists. |

## Provider support semantics

`support_level` is a product/certification label, not a wishlist. A provider catalog entry must not advertise capabilities above the adapter returned by `resolveProvider()`:

- `mock-provider` is certified because it is deterministic and covers the audited demo/test vertical slice.
- The CLI/OAuth provider lane (Codex CLI, Claude CLI, Gemini CLI) was retired on 2026-06-29. The surviving live providers — `openrouter` (the default), `openai-api`, `anthropic-api`, `gemini-developer-api` — share one function-calling grounded tool loop, are usable once a key is configured, and stay labeled `experimental`: per-model certification is an optional deeper audit whose responsibility sits with the user, and support labels never rise above the latest recorded report.

Direct API adapters can later receive separate provider IDs or revised labels after their certification reports land. Until then, provider status UI/API paths must derive readiness and effective support from the latest persisted certification report, not from catalog optimism or credential presence alone.

## Route/page ownership map

These pages can be implemented by downstream lanes without renaming the underlying projection owners.

This is the live route set as implemented under `apps/web/src/app/**/page.tsx`. There is no standalone `/shariah` or `/worker` page: Shariah status is surfaced inside `/performance`, and worker/scheduled-task settings live under `/settings/automation`. `/providers` is retired and permanently redirects to `/settings/providers`.

| Domain | Package owner | Route/page owner | Initial contract |
|---|---|---|---|
| Command center | `@owlfolio/ledger` | `/` | Cross-domain home: workflow entry points and current portfolio/workflow state. |
| Onboarding | `@owlfolio/shared` | `/onboarding` | Guided local setup; writes app config + ledger paths. |
| Strategy | `@owlfolio/strategies` | `/strategy` | Buffett 4-Pillar strategy overview and live valuation/sizing parameters. |
| Learn | `@owlfolio/strategies` | `/learn` | Educational tabs explaining the strategy, valuation, and provider model. |
| Research pipeline | `@owlfolio/workflow` | `/research`, `/research/new`, `/research/[caseId]` | Research case list, new-case intake, and the per-case decision dossier. |
| Pipeline | `@owlfolio/workflow` | `/pipeline` | Cross-stage research/watchlist/holding pipeline view. |
| Watchlist | `@owlfolio/workflow` | `/watchlist` | Admitted candidates with the frozen model-proposed buy-below and buy-zone status. |
| Lifecycle | `@owlfolio/workflow` | `/lifecycle` | Held-name lifecycle: holdings, sell triggers, re-underwrite state. |
| Portfolio | `@owlfolio/ledger` | `/portfolio` | Positions, investable capital, and portfolio composition. |
| Performance | `@owlfolio/ledger` | `/performance` | Performance summary and Shariah status surfacing. |
| Monthly accounting | `@owlfolio/ledger` | `/accounting/monthly` | Monthly snapshots, NAV, cash balance, position values, realized/unrealized summaries. |
| Purification | `@owlfolio/ledger` | `/purification` | Obligations, payments, remaining owed, period/source linkage. |
| Audit trail | `@owlfolio/ledger` | `/audit` | Cross-domain ledger timeline with event IDs, actor, causation/correlation, and sources. |
| Provider settings | `@owlfolio/providers` | `/settings/providers` | Catalog support level, readiness, latest provider runs, and per-provider trust/certification. |
| Automation settings | `@owlfolio/ledger` | `/settings/automation` | Scheduled-task / worker configuration and run state. |
| Data-safety settings | `@owlfolio/shared` | `/settings/data-safety` | Local data location, backup, and reset controls. |

## Downstream integration notes

- Domain lanes should import `domainEventContracts` rather than inventing new event names for these families.
- Projection implementations should keep user-authored transitions separate from provider/worker-authored drafts or evaluations.
- Accounting and purification should treat cash movement, NAV snapshot, obligation, and payment as separate event families even if the first UI renders them together.
- Provider pages should display `support_level` as the conservative label from catalog/certification, not as the maximum possible model capability.
