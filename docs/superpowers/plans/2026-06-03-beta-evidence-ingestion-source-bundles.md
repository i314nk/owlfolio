# Beta evidence ingestion/source-bundle provenance slice

## Goal
Add the first small, local-first evidence-ingestion path for manually supplied source files or URLs without letting providers write opaque evidence directly into trusted workflow state.

## Scope
- Keep this slice in `packages/workflow` unless a web/API route remains small after the contracts land.
- Add an allowlisted ingestion helper for `local-file` and `url` source inputs.
- Record source bundle metadata, checksums, source/provider attribution, user/system ingestion actor, redacted privacy fields, and missing/unavailable evidence status.
- Avoid leaking local absolute paths, user home directories, file names, or secrets into bundle JSON/metadata.
- Keep provider output as proposed source records; ingestion is performed by user/system code and returns auditable source bundle records.

## TDD checkpoints
1. RED tests for local-file provenance/checksums/redaction.
2. RED tests for ticker/source isolation and sanitized bundle paths.
3. RED tests for missing/unavailable evidence status.
4. RED tests that provider proposals cannot mark themselves as trusted ingestion actors and that no secrets/paths leak.
5. Implement minimal source-ledger ingestion code and preserve existing workflow tests.
6. Verify focused workflow tests, then repo typecheck/test/lint.
