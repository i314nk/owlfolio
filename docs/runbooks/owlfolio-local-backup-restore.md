# Owlfolio local backup and restore runbook

Last verified: 2026-06-03 by Kanban task `t_5e88b75c` against checkpoint `0b54de0` using an isolated temporary runtime.

## Purpose

Owlfolio alpha is local-first: the user's investment workflow state lives in local config, SQLite ledgers, source-ledger bundles, and provider certification/report files. This runbook defines the first safe backup and restore workflow for those runtime artifacts without copying credentials or accidentally committing runtime files to git.

## Runtime state inventory

Canonical paths are resolved from `OWLFOLIO_PROJECT_DIR` plus environment/config overrides:

| State | Default path | Override/config source | Include in backup? | Notes |
| --- | --- | --- | --- | --- |
| App config | `data/app-config.json` | `OWLFOLIO_APP_CONFIG_PATH` | Yes, allowlisted fields only | Contains mode, provider id/support level, strategy, Shariah defaults, market universe, `ledger_path`, `source_ledger_path`, and initialization timestamp. It should not contain secrets. |
| Demo ledger | `data/demo-ledger.sqlite` | `OWLFOLIO_DEMO_LEDGER_PATH` | Optional | Deterministic demo/runtime state; useful for demos, not required for personal recovery. |
| Personal/local ledger | `data/personal-ledger.sqlite` | `OWLFOLIO_PERSONAL_LEDGER_PATH`; persisted as `app-config.json.ledger_path` after onboarding | Yes | Append-only SQLite event store for research, watchlist, holdings, accounting, purification, Shariah, worker, and audit events. |
| Worker/default ledger | `data/owlfolio-ledger.sqlite` | `OWLFOLIO_LEDGER_PATH`; worker falls back to `app-config.json.ledger_path`, then this path | Yes if present | Used by worker/admin flows when not pointed at the personal ledger. |
| Source ledger bundles | `data/source-ledger/` | `OWLFOLIO_SOURCE_LEDGER_PATH`; persisted as `app-config.json.source_ledger_path` | Yes | JSON source bundles such as `research-source-bundle-<case>.json`; may include source excerpts and URLs, so treat as private research material. |
| Provider certification reports | `data/provider-certifications/` | `OWLFOLIO_PROVIDER_CERTIFICATION_DIR` | Yes | Latest certification evidence and historical reports; must remain redacted and never include raw credentials. |
| SQLite sidecar files | `<ledger>.sqlite-wal`, `<ledger>.sqlite-shm`, plus `*.db-wal`/`*.db-shm` | SQLite runtime | Yes when present | Required for a byte-copy backup if SQLite is open or WAL is enabled. Prefer the SQLite `.backup` API/CLI where available. |
| Process IDs/logs | `data/*.pid`, `logs/`, `*.pid` | runtime | No | Ephemeral and sometimes misleading after restore. |
| Test/runtime scratch | `.playwright-runtime/`, `.live-openai-runtime/`, `test-results/`, `playwright-report/`, `.next/`, `.worktrees/` | tests/builds/worktrees | No by default | These are generated or isolated test artifacts; never include in a personal backup unless explicitly debugging a test run. |
| Credentials/secrets | `.env*`, `secrets/`, `~/.claude`, `CODEX_HOME`, `GEMINI_HOME`, `OWLFOLIO_*_AUTH_PATH` targets | environment/user home | No | Backup should record only provider IDs/readiness labels. Re-authenticate providers after restore. |

Current observed runtime artifacts in this repo during verification: `data/demo-ledger.sqlite`, `data/source-ledger/`, `data/provider-certifications/`, `data/portfolio.db`, `data/*.pid`, `.playwright-runtime/`, `.live-openai-runtime/`, and `.worktrees/`. `data/portfolio.db` appears to be legacy/runtime data and should not be part of the first v2 restore contract unless a later inventory proves an active v2 code path reads it.

## Local-first UX proposal

Add an "Operations" or "Data safety" panel under Settings/Provider status with two simple actions:

1. `Create local backup`
   - Shows detected runtime paths before running.
   - Writes a timestamped archive outside the repo by default, for example `~/Owlfolio Backups/owlfolio-backup-YYYYMMDD-HHMMSS.tar.gz` (or `.tar.zst` when a zstd implementation is added).
   - Displays a privacy warning: archive contains investment decisions, research sources, and provider certification metadata, but not API keys or CLI auth tokens.
   - Produces a manifest with schema version, app version/git commit if available, file list, SHA-256 checksums, redacted provider summary, and ignored paths.
2. `Restore from local backup`
   - Defaults to a new isolated runtime directory, not overwriting current `data/`.
   - Shows a dry-run diff: config mode/provider, ledger event count, source bundle count, latest provider certification reports, and paths that will be rewritten.
   - Requires explicit confirmation before replacing active runtime paths.
   - Rewrites restored `app-config.json` paths to the selected restore location unless the operator chooses "restore exact absolute paths".
   - Runs projection/provider verification before marking the restore ready.

Keep the CLI/operator path first, then wire the same manifest/restore library into the web UX.

Implemented first CLI slice:

```bash
corepack pnpm ops:backup:inventory
corepack pnpm ops:backup:manifest -- --output /tmp/owlfolio-backup-manifest.json
corepack pnpm ops:restore:dry-run -- --manifest /tmp/owlfolio-backup-manifest.json --restore-root /tmp/owlfolio-restore
corepack pnpm ops:restore:verify -- --manifest /tmp/owlfolio-backup-manifest.json --restore-root /tmp/owlfolio-restore
```

The manifest command resolves the allowlisted runtime inventory and emits checksums for existing files. It does not copy credentials, logs, PIDs, generated test/build/runtime dirs, or create/restore archives yet.

## Operator backup flow

Run from the repo root. Do not put backup output under the git checkout.

```bash
set -eu
export OWLFOLIO_PROJECT_DIR=${OWLFOLIO_PROJECT_DIR:-$PWD}
BACKUP_ROOT=${OWLFOLIO_BACKUP_ROOT:-$HOME/Owlfolio Backups}
STAMP=$(date -u +%Y%m%d-%H%M%SZ)
STAGING=$(mktemp -d "${TMPDIR:-/tmp}/owlfolio-backup-${STAMP}.XXXXXX")
ARCHIVE="$BACKUP_ROOT/owlfolio-backup-${STAMP}.tar.gz"
mkdir -p "$BACKUP_ROOT" "$STAGING/runtime"

# 1. Confirm no runtime files are tracked before backup.
git check-ignore -v data .playwright-runtime .live-openai-runtime .worktrees
if git ls-files | grep -E '(^data/|\.sqlite$|\.db$|\.db-wal$|\.db-shm$|provider-certifications|source-ledger|app-config\.json|test-results|playwright-report|\.tsbuildinfo$)'; then
  echo "Refusing backup: runtime-like files are tracked by git" >&2
  exit 1
fi

# 2. Copy allowlisted runtime state only.
copy_if_present() {
  src="$1"
  dst="$2"
  if [ -e "$src" ]; then
    mkdir -p "$(dirname "$dst")"
    cp -a "$src" "$dst"
  fi
}
copy_if_present data/app-config.json "$STAGING/runtime/data/app-config.json"
copy_if_present data/demo-ledger.sqlite "$STAGING/runtime/data/demo-ledger.sqlite"
copy_if_present data/personal-ledger.sqlite "$STAGING/runtime/data/personal-ledger.sqlite"
copy_if_present data/owlfolio-ledger.sqlite "$STAGING/runtime/data/owlfolio-ledger.sqlite"
copy_if_present data/source-ledger "$STAGING/runtime/data/source-ledger"
copy_if_present data/provider-certifications "$STAGING/runtime/data/provider-certifications"

# Include SQLite sidecars if they exist. If the app/worker is running, prefer a future SQLite .backup implementation.
for sidecar in data/*.sqlite-wal data/*.sqlite-shm data/*.db-wal data/*.db-shm; do
  [ -e "$sidecar" ] || continue
  copy_if_present "$sidecar" "$STAGING/runtime/$sidecar"
done

# 3. Write a manifest without secrets.
{
  echo "schema_version: 1"
  echo "created_at_utc: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "project_dir: $OWLFOLIO_PROJECT_DIR"
  echo "git_commit: $(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
  echo "included_paths:"
  (cd "$STAGING/runtime" && find data -type f -print | LC_ALL=C sort | sed 's/^/  - /')
  echo "excluded_paths:"
  echo "  - .env*"
  echo "  - secrets/"
  echo "  - data/*.pid"
  echo "  - logs/"
  echo "  - .next/"
  echo "  - .playwright-runtime/"
  echo "  - .live-openai-runtime/"
  echo "  - .worktrees/"
  echo "checksums_sha256:"
  (cd "$STAGING/runtime" && find data -type f -print0 | LC_ALL=C sort -z | xargs -0 sha256sum | sed 's/^/  - /')
} > "$STAGING/manifest.yaml"

# 4. Create archive and verify git status stayed scoped.
tar -C "$STAGING" -czf "$ARCHIVE" manifest.yaml runtime
git status --short --branch
echo "Backup written: $ARCHIVE"
```

Production-quality implementation should replace raw SQLite file copying with a helper that opens each ledger read-only and runs SQLite's online backup API into staging. Until that exists, stop the web app/worker before copying active ledgers or include `-wal`/`-shm` sidecars.

## Operator restore flow

Restore into an isolated directory first. Only promote it to the active `data/` after verification passes.

```bash
set -eu
ARCHIVE=${ARCHIVE:?set ARCHIVE=/path/to/owlfolio-backup.tar.gz}
RESTORE_ROOT=${RESTORE_ROOT:-$(mktemp -d "${TMPDIR:-/tmp}/owlfolio-restore-runtime.XXXXXX")}
rm -rf "$RESTORE_ROOT"
mkdir -p "$RESTORE_ROOT"
tar -C "$RESTORE_ROOT" -xzf "$ARCHIVE"

# Inspect manifest before trust.
sed -n '1,160p' "$RESTORE_ROOT/manifest.yaml"

# Use restored paths explicitly for smoke verification.
export OWLFOLIO_PROJECT_DIR=$PWD
export OWLFOLIO_APP_CONFIG_PATH=$RESTORE_ROOT/runtime/data/app-config.json
export OWLFOLIO_DEMO_LEDGER_PATH=$RESTORE_ROOT/runtime/data/demo-ledger.sqlite
export OWLFOLIO_PERSONAL_LEDGER_PATH=$RESTORE_ROOT/runtime/data/personal-ledger.sqlite
export OWLFOLIO_LEDGER_PATH=$RESTORE_ROOT/runtime/data/personal-ledger.sqlite
export OWLFOLIO_SOURCE_LEDGER_PATH=$RESTORE_ROOT/runtime/data/source-ledger
export OWLFOLIO_PROVIDER_CERTIFICATION_DIR=$RESTORE_ROOT/runtime/data/provider-certifications

# Verification gates. Keep auth blank unless intentionally re-authenticating after restore.
env -u ANTHROPIC_API_KEY -u OPENAI_API_KEY -u GEMINI_API_KEY -u GOOGLE_API_KEY \
  corepack pnpm test packages/ledger/src/__tests__/commandCenterProjection.test.ts \
    packages/ledger/src/__tests__/holdingProjection.test.ts \
    packages/ledger/src/__tests__/watchlistProjection.test.ts \
    packages/ledger/src/__tests__/accountingProjection.test.ts \
    packages/ledger/src/__tests__/purificationProjection.test.ts \
    packages/ledger/src/__tests__/scheduledTaskProjection.test.ts

# Do not add apps/worker/src/__tests__/runtime.test.ts to the restore-env command above.
# That unit test creates its own temporary runtime and can inherit restored provider
# certification paths from the parent environment; the worker dry-run below is the
# restored-runtime verification gate.

env -u ANTHROPIC_API_KEY -u OPENAI_API_KEY -u GEMINI_API_KEY -u GOOGLE_API_KEY \
  corepack pnpm worker -- --once --dry-run --define-defaults

git status --short --branch
```

Expected restore evidence:

- Projection tests pass against the restored ledger contract.
- Worker dry-run resolves `config_path`, `ledger_path`, `source_ledger_path`, and `provider_certification_dir` from restored paths and does not require provider secrets.
- Provider status remains bounded by restored certification reports; no unsupported/experimental provider becomes certified only because credentials exist. If a legacy certification report lacks current `target` metadata, regenerate provider certification before using scheduled provider execution.
- Source bundles are present and still referenced by ledger `source_ids` where applicable.
- `git status --short --branch` shows only intentional source/doc changes, not restored `data/`, restore temp directories, `.playwright-runtime/`, `.live-openai-runtime/`, `.worktrees/`, SQLite sidecars, or provider reports.

After verification, either keep the restored runtime isolated by launching the app with the environment variables above, or promote files into `data/` manually while the app/worker are stopped.

## Safety rules

- Never include `.env*`, provider CLI auth files, API keys, `secrets/`, or home-directory credential stores in a backup archive.
- Do not commit backup archives, restored runtime directories, provider reports under `data/`, or SQLite files. `.gitignore` currently ignores `/data/`, `.playwright-runtime/`, `.live-openai-runtime/`, `.worktrees/`, `*.sqlite`, `*.db`, and SQLite sidecars; keep that guard intact.
- Treat source bundles as private research/evidence material even when they contain only public URLs/excerpts.
- Restore to a throwaway runtime directory first. Avoid overwriting the active personal ledger until projections and provider status have been checked.
- Re-authenticate providers after restore. Backup/restore should preserve provider evidence and readiness labels, not credentials.
- Preserve user-authored ledger transitions. Do not generate new approvals, watchlist confirmations, holding opens, Shariah overrides, or purification payments as part of restore.

## Implementation card recommendations

1. `ops: add runtime inventory and manifest builder`
   - Implement a shared runtime-state inventory helper that resolves app config, ledgers, source ledger, provider certification dir, SQLite sidecars, and excluded paths from env/config.
   - Unit-test default paths, env overrides, app-config overrides, and secret exclusion.
2. `ops: implement safe local backup CLI`
   - Add `corepack pnpm owlfolio backup create --output <dir>` or a scripts entry that stages allowlisted files outside the repo, uses SQLite online backup where possible, writes a manifest/checksums, and refuses tracked runtime artifacts.
3. `ops: implement restore dry-run and path rewrite`
   - Add restore dry-run that reads the manifest, validates checksums, rewrites `ledger_path`/`source_ledger_path` into an isolated restore root, and prints a human-readable diff before promotion.
4. `ops: add restore verification command`
   - Add a CLI/test helper that loads restored ledgers and reports projection counts for Command Center, research cases, watchlist, holdings, accounting, purification, scheduled tasks, source bundle links, and provider certification status.
5. `web: add Settings data safety panel`
   - Surface backup/restore status, detected runtime paths, last backup metadata, privacy warnings, and restore verification results without exposing secret paths or raw credentials.
6. `ops: document quarterly restore drill`
   - Add a release-gate/checklist task that restores the latest backup into an isolated runtime, runs projection/provider/worker verification, and confirms clean git status.
