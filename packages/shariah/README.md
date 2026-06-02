# @owlfolio/shariah

Pure Shariah policy/evaluation domain package for Owlfolio v2.

Current scope:
- Encodes the app-config AAOIFI policy defaults as an executable policy boundary.
- Evaluates sourced assessments into `COMPLIANT`, `CONDITIONAL`, `NON_COMPLIANT`, or `PENDING`.
- Requires sourced evidence for business activity and non-compliant income ratio before returning a passing status.
- Keeps workflow gates, watchlist/holding transitions, purification calculations, and UI wiring out of this package.

Policy-configurable today:
- `policy_basis`: currently `AAOIFI` only.
- `allow_conditional`: whether uncertain/threshold-equal findings may produce `CONDITIONAL` instead of `PENDING`.
- `non_compliant_income_threshold`: default `0.05` from app config.

Hard-coded domain defaults today:
- Required requirements: `business_activity` and `non_compliant_income_ratio`.
- Prohibited business activity is always `NON_COMPLIANT`.
- Threshold-equal non-compliant income is `CONDITIONAL` when conditional handling is enabled.
- Passing/non-pending outcomes require sourced evidence with a source id and summary.
