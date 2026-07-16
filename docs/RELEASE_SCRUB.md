# Pre-Release Scrub Checklist

Items to clean before publishing Owner's Manual as an open-source repo on GitHub.

**Audit date:** 2026-05-01 (updated 2026-05-08)
**Audit result:** DONE. All scrubs applied. Git history is clean (no secrets ever committed). `.gitignore` is comprehensive.

---

## 1. Personal Data in Docs & Tests

| File | Line(s) | Issue | Fix |
|------|---------|-------|-----|
| `owlfolio.service` | 7-9 | Hardcoded `/home/clawdbot` paths, `User=clawdbot` | Replace with generic example paths (`/home/USER/owlfolio`) |
| `docs/archive/PHASE_2.md` | ~104 | References `Baraka, Sarwa, XCube` (personal broker names) | Replace with generic broker names (e.g. "Broker A, Broker B") |
| `tests/test_db.py` | ~440 | `"Uses Baraka for US stocks"` in test fixture | Replace with generic test data |
| `docs/NANOJEV_CONTRIBUTIONS.md` | Throughout | References NanoJev (private assistant) | ✅ Renamed to `CHANGELOG_ADDITIONS.md`, all "NanoJev" replaced with "contributor" |
| `CREDITS.md` | ~113-114 | Mentions NanoJev by name | Replace with generic description |
| `docs/archive/FLAGS.md` | ~13 | References NanoJev | Replace with generic reference |
| `docs/archive/SPECIALIST_TUNING.md` | ~29 | References NanoJev | Replace with generic reference |

## 2. Service File

`owlfolio.service` should be renamed to `owlfolio.service.example` with placeholder paths:

```ini
User=YOUR_USERNAME
WorkingDirectory=/home/YOUR_USERNAME/owlfolio
```

## 3. Data Files (Not in Git, But Be Careful)

These files are gitignored and safe, but must be excluded from any tarball/zip distribution:

| File | Contains |
|------|----------|
| `.env` | Claude OAuth token |
| `secrets/anthropic_key` | Same token (for Docker specialists) |
| `data/portfolio.db` | Real analysis data (watchlist, valuations, decisions) |
| `data/config.yaml` | Personal market/timezone config |
| `methodology.yaml` | Active strategy selection |

## 4. Already Safe (No Action Needed)

- **Git history:** 10 commits, no secrets ever committed
- **`.gitignore`:** Covers `.env`, `secrets/`, `data/`, `methodology.yaml`, `config.yaml`, `*.db`
- **`.env.example`:** Uses placeholder values (`sk-ant-...`, `your-email@example.com`)
- **Author name** in `LICENSE` and `pyproject.toml` — standard for open source, keep as-is
- **Stock tickers** in strategy presets — used as illustrative examples of business types, not personal holdings
- **`data/config.yaml` default timezone** (`Asia/Dubai`) — gitignored, never committed
- **API token rotation** — not required since keys were never committed; `.gitignore` prevents accidental commit

## 5. Recommended Pre-Publish Commands

```bash
# Verify nothing sensitive is tracked
git status
git ls-files | grep -iE '\.env|secret|credential|anthropic_key'

# Dry-run: check what a git archive would include
git archive --list HEAD | grep -iE '\.env|secret|data/'

# Final check: search for sk-ant in tracked files
git grep 'sk-ant'
```

## Effort Estimate

~30 minutes. All changes are in docs, tests, and the service file — no runtime code affected.
