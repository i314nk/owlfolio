# Credits

Owner's Manual (engine namespace Owlfolio; earlier working names Owlfolio/OwlClaw) is a local-first investment workflow application built as an educational project and portfolio piece. The active v2 branch is a TypeScript/pnpm monorepo with a Next.js web app, local SQLite ledger, provider certification harness, and dry-run worker. This file lists the projects whose patterns, infrastructure, or prior art Owlfolio adopts, and credits them unambiguously.

---

## Active v2 stack

- **Next.js / React / TypeScript** — the primary local web app, route handlers, and UI component model.
- **pnpm workspaces** — monorepo package management for `apps/*` and `packages/*`.
- **SQLite** — append-only local ledger storage and projection source.
- **Playwright** — browser end-to-end verification for onboarding and workflow surfaces.
- **Vitest / Testing Library** — package, helper, projection, and component tests.
- **Zod** — runtime schema validation for provider/workflow/config surfaces where used.

---

## Provider runtimes and certification candidates

Owner's Manual is provider-neutral at the workflow boundary: provider outputs are drafts or observations, while portfolio transitions remain explicit user-authored ledger events.

Current alpha provider evidence is bounded by `data/provider-certifications/*.latest.json` and `docs/architecture/owlfolio-v2-provider-model-support.md`:

- **Mock provider** — deterministic demo/test provider used for certified alpha regression coverage. It is not real investment intelligence.

The surviving providers are OpenRouter (the default meta-aggregator) and an experimental local OpenAI-compatible endpoint (Ollama / vLLM); their trademarks belong to their owners. Support labels never exceed the latest recorded certification evidence.

---

## Investment methodology prior art

Owlfolio's strategy references are original implementation/prose, but they are inspired by well-known investment traditions. Buffett-Munger is the default strategy direction; other strategy concepts require additional policy/audit/provider gates before they become first-class workflows.

| Strategy concept | Inspired by |
| --- | --- |
| Buffett-Munger / quality compounders | Warren Buffett, Charlie Munger, Berkshire Hathaway letters, Munger's *Almanack* |
| Quality compounder | Terry Smith, Nick Sleep, long-term quality investing writing |
| 100-bagger | Chris Mayer's *100 Baggers*, Thomas Phelps's *100 to 1 in the Stock Market* |
| GARP / growth | Peter Lynch and modern growth-investing heuristics |
| Dividend income | Dividend-growth investing traditions |
| Deep value | Benjamin Graham, Walter Schloss, Seth Klarman |

Owlfolio's methodology prose should paraphrase and attribute traditions rather than quote source material directly.

---

## Shariah domain caveat

Shariah screening in Owner's Manual is a grounded, optional, local decision-support aid — never a fatwa. This is an educational project: obtain a ruling from certified Islamic scholars before acting on any Shariah conclusion.

---

## Other inspirations and prior art

- **The “specialists + synthesis” multi-agent pattern** — Owlfolio's provider workflow resembles broader multi-agent research patterns explored by LangGraph, CrewAI, Claude/Agent SDKs, OpenAI Agents/Codex, and related systems. Owlfolio's implementation is independent and tuned for ledger-audited investment workflow boundaries.
- **External reviewer** — produced the original `docs/FLAGS.md` review of Owlfolio's early code and informed later verification discipline.

---

## Licenses

- Owlfolio itself: see `LICENSE` in this repository.
- Third-party frameworks/tools listed above remain governed by their respective licenses and service terms.

---

## How to add to this file

If you contribute a feature that adopts a meaningful pattern, design, or substantial idea from another project, please add an entry naming the source and linking to it. The principle: make the lineage visible, keep support claims evidence-bounded, and keep contributor work distinguishable from prior art.
