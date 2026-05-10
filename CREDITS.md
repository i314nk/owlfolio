# Credits

Owlfolio (renamed from OwlClaw on 2026-04-26) is an investment-research application built on
the Claude Agent SDK. Most of the project — the strategy library, the
specialist + synthesis pipeline, the portfolio model, the CLI, and the web
UI — is original work. This file lists the projects whose patterns,
infrastructure, or prior art Owlfolio adopts, and credits them
unambiguously.

---

## Agent runtime — Claude Agent SDK (Anthropic)

Owlfolio is built end-to-end on the **[Claude Agent SDK](https://docs.claude.com/en/api/agent-sdk/overview)**.
Every specialist subagent, the synthesis agent, and both chat surfaces
(CLI and Web) run as `sdk_query()` / `ClaudeSDKClient` calls with adaptive
extended thinking enabled. The SDK provides:

- The `query()` and `ClaudeSDKClient` agent loop primitives.
- Tool dispatch (`WebSearch`, `WebFetch`, `Read`, etc.).
- The streaming events Owlfolio's web UI consumes for token-level
  rendering and tool-use indicators (`StreamEvent`,
  `include_partial_messages=True`).
- Adaptive thinking budget control (`thinking={"type": "adaptive"}`).

Owlfolio is Claude-only by design; the Agent SDK is the sole supported
runtime. See `docs/ARCHITECTURE.md` → **Key Design Decisions** for the
rationale.

---

## Investment methodology prior art

The seven preset strategy YAMLs are original to Owlfolio in their
implementation, but each is built on the published thinking of well-known
investors. The strategies don't quote any of these sources directly; they
distill the public-domain core ideas of each philosophy into a
machine-readable specialist roster + criteria + valuation methodology.

| Strategy | Inspired by |
|---|---|
| `buffett-munger` | Warren Buffett & Charlie Munger (Berkshire Hathaway shareholder letters; Munger's *Almanack*) |
| `quality-compounder` | Terry Smith (Fundsmith); Nick Sleep (Nomad Partnership Letters) |
| `100-bagger` | Chris Mayer (*100 Baggers*); Thomas Phelps (*100 to 1 in the Stock Market*) |
| `garp` | Peter Lynch (*One Up on Wall Street*) |
| `growth` | Peter Lynch (PEG ratio); modern growth investing principles (Rule of 40) |
| `dividend-income` | Dividend Aristocrat methodology; long-form dividend-growth investing tradition |
| `deep-value` | Benjamin Graham (*The Intelligent Investor*); Walter Schloss; Seth Klarman (*Margin of Safety*) |

Owlfolio's strategy prose paraphrases these traditions in its own words.
Anyone improving a preset is encouraged to keep the prose original and
attribution-style — link to the underlying source in the YAML's header
comment when relevant.

---

## Other inspirations and prior art

- **Typer** (`tiangolo/typer`) — Owlfolio's CLI is built on Typer's
  type-annotated argument model.
- **FastAPI + Pydantic + htmx + Alpine.js + Tailwind CSS** — the
  web UI stack. None of these need attribution beyond their licenses,
  but they are core to how Owlfolio looks and feels.
- **The "specialists + synthesis" multi-agent pattern** is similar in
  spirit to multi-agent research patterns explored by LangGraph, CrewAI,
  and others. Owlfolio's implementation is independent and tuned for the
  investment-research domain, but the broader idea of "fan out to
  domain-expert agents, fan in to a synthesizer" is shared community
  knowledge by 2026.
- **External reviewer** — produced the original `docs/FLAGS.md` review of Owlfolio's Phase 3a code, used as an external reviewer during this project's development.

---

## Licenses

- **Claude Agent SDK** — Anthropic's SDK terms apply. See
  https://docs.claude.com.
- **Owlfolio** itself: see `LICENSE` in this repository.

---

## How to add to this file

If you contribute a feature that adopts a meaningful pattern, design, or
substantial idea from another project, please add an entry here naming
the source and linking to it. The principle: **make the lineage
visible.** It's how a small open-source project earns trust and how a
contributor's original work is distinguishable from prior art.
