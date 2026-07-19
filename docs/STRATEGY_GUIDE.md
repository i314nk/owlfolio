# Owner's Manual strategy guide

This is the active Owner's Manual v2 local-use candidate strategy guidance. (The pre-rework Python/YAML strategy runtime and its guide were removed with the v1 cleanup.)

## Local-use candidate stance

Buffett 4-Pillar is the default strategy direction for the v2 local-use candidate. Other strategy concepts and custom/manual strategy YAML support remain advanced or experimental until they have policy gates, valuation rules, Shariah handling, provider role certification, and ledger/audit coverage.

Do not present custom strategy creation as the main UI path. The primary product flow should guide users through default/preset strategy choices and explicit review decisions.

## Strategy workflow boundaries

A strategy may influence:

- research-case framing,
- provider prompt/context selection,
- valuation and review criteria,
- watchlist recommendation language,
- holding-review cadence and rationale,
- Shariah/accounting/purification policy checks where applicable.

A strategy must not bypass:

- provider certification boundaries,
- source-grounding requirements,
- Shariah policy gates,
- explicit user confirmation for watchlist and holding transitions,
- accounting period/as-of boundaries,
- purification obligation/payment separation.

## Provider and ledger rules

- Provider-authored strategy outputs are drafts or observations.
- User-authored events are required for confirmed watchlist items, open holdings, review overrides, and purification payments.
- Every provider-authored proposal should preserve provider id, model id/version, support tier, source ids, and run/certification context.
- Strategy claims should not imply provider readiness or certification beyond the latest provider report.

## Future work for additional strategies

A strategy becomes first-class only after it has:

1. typed workflow contracts and projection coverage,
2. valuation/review rules appropriate to the strategy,
3. Shariah policy handling and conservative fallbacks,
4. provider certification evidence for relevant roles,
5. UI copy that explains limits and required user review,
6. tests spanning research, watchlist, holding review, accounting, purification, and audit projections where relevant.

Historical YAML examples may still be useful as design references, but they are not the active v2 runtime contract unless reintroduced through tested TypeScript packages.
