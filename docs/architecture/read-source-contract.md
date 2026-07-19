# `read_source` executor contract (provider tree ⇄ EDGAR tree)

> **HISTORICAL NOTE (2026-07-19).** Parts of this document predate the 2026-06-29 CLI/OAuth
> provider excision, the 2026-07-18 provider consolidation (OpenRouter + an experimental local
> endpoint ONLY), and the model-tiering removal (ONE configured model runs every stage). References
> to Codex/Claude/Gemini CLI providers, direct API surfaces, T1/T2/T3 tiers, or `OWLFOLIO_MODEL_ROLE_*`
> are preserved as decision-record context — they do not describe the current app.


**Status:** agreed seam. **Owned by:** EDGAR tree (builds `read_source`). **Consumed by:** provider
tree (the tool loop that calls it). This document is the spec the EDGAR tree builds against so there is
**no adapter layer** between the two trees.

## Why this seam exists

A grounded 10-K is content-hashed and ledgered, but the **full text is not retained** —
`fetchAndCaptureSource` keeps only a ~600-char excerpt + the SHA-256 `content_hash`
(`packages/workflow/src/sourceGrounding.ts`). "Let the model read the 10-K" is therefore **not** a
ledger lookup; it needs a dedicated, section-scoped, hash-verified read path. The EDGAR tree builds
that path as a new grounded tool, `read_source`. The provider tree's tool loop consumes it exactly
like every other grounded tool.

## Integration point — no new interface

`read_source` is just another grounded tool. It plugs into the **existing** machinery:

- The provider tool loop calls an injected executor of type
  `ProviderToolExecutor = (toolName: string, args: unknown) => Promise<string>`
  (`packages/providers/src/providerContract.ts`), supplied to `provider.runToolLoop(request, schema,
  executor)`.
- The executor + tool registry live harness-side in `packages/workflow/src/groundedAgent.ts`:
  `GROUNDED_TOOL_NAMES`, `GROUNDED_TOOL_PARAMETERS`, and `buildGroundedToolExecutor`.

**The EDGAR tree's build is therefore:**
1. Add `'read_source'` to `GROUNDED_TOOL_NAMES`.
2. Add its arg JSON Schema to `GROUNDED_TOOL_PARAMETERS` (below).
3. Add a `read_source` branch to the `executor` inside `buildGroundedToolExecutor` that performs the
   hash-verify-on-read + section mapping over `secEdgar.ts` / the source ledger, and returns the
   string described below.

No change is needed in `packages/providers` for the OpenRouter path (see "Routing confirmation").

## Arg JSON Schema (the model-facing tool signature)

```jsonc
read_source: {
  type: 'object',
  additionalProperties: false,
  required: ['source_id'],
  properties: {
    source_id: {
      type: 'string',
      description:
        'A harness-verified source_id previously returned by fetch_source/search_filings, or a ' +
        'pre-verified EDGAR id (e.g. sec_edgar_10k_<cik>_fy<year>).',
    },
    section: {
      type: 'string',
      description:
        'Optional section label to scope the read, e.g. a 10-K item ("Item 1A" Risk Factors, ' +
        '"Item 7" MD&A). The harness maps it to the section; omit to read from the document start.',
    },
    offset: {
      type: 'number',
      description:
        'Optional 0-based character offset into the (section or whole-document) text — for paging ' +
        'long sections and for non-item documents (8-K, transcripts).',
    },
    limit: {
      type: 'number',
      description: 'Optional max characters to return from offset; the harness also caps this.',
    },
  },
}
```

`section` is **free text**, not an enum: 10-Ks are item-structured but the EDGAR tree's later 8-K
grounded tier and transcripts are not, so the harness maps the label and falls back to `offset`/`limit`
paging. This keeps the contract stable when the 8-K tier lands.

## Return shape — a single string (mirrors `fetch_source`)

The executor returns a plain string fed back to the model as a `tool` message — the same convention as
`formatFetchResult` (`packages/workflow/src/groundedAgent.ts`). Four cases:

- **Success:**
  `READ source_id=<id> status=available section=<label|full> range=<offset>-<end> content_hash=<sha256>`
  followed by `\nexcerpt: <verified section text>`.
- **Fail-closed on hash mismatch:**
  `READ source_id=<id> status=uncitable reason=content_hash_mismatch`
  followed by `\n(The ledgered content could not be re-verified; you may NOT cite <id>.)`
  — **never** return the stale excerpt and **never** an unverified copy. Re-reading cannot launder an
  unverified citation.
- **Unknown / unverified id:** `TOOL ERROR: read_source: no verified source for source_id=<id>.`
- **Missing arg:** `TOOL ERROR: read_source requires a non-empty source_id.`

## Invariants the contract pins

- **`verified_ids` semantics.** A `status=available` read keeps/asserts `source_id` in the executor's
  `verified_ids` accumulator (`GroundedToolExecutor.verified_ids`), so the Phase-2 finding may cite it
  — the same set Phase-2 cite-checks against today. A `status=uncitable` read **never** adds the id.
- **Lane tag preserved.** A read source is governed by the **same** per-lane source policy as a fetched
  one. Route it through `groundProposedSourcesForLane` / `classifySourceCategory` /
  `isCategoryAllowedForLane` (`packages/strategies/src/sourcePolicy.ts`) so the read carries its
  `source_category`/lane tag and is **no more permissive** than a cited source.
- **Hash verify on read.** Content is verified against the ledgered `content_hash` (re-fetching the
  immutable EDGAR Archives URL when needed). Verification is the gate for citability, per above.

## Routing confirmation (the provider tree's answer)

`openRouterProvider.runToolLoop` (`packages/providers/src/openRouterProvider.ts`) is
**tool-name-agnostic**: for every allowlisted tool it calls `executor(name, args)` and feeds the
returned string back as a `tool` message. It therefore routes `read_source` through the **same
harness-injected executor** as `fetch_source`, with **zero** provider-tree code change. Existing
evidence: the `runToolLoop` tests in `packages/providers/src/__tests__/openRouterProvider.test.ts`.

The **Codex app-server** path (replacing the current one-shot `codex exec --sandbox read-only` in
`packages/providers/src/openaiCodexCliProvider.ts`) is deferred to its own plan. When built, it MUST
preserve this invariant: `read_source` — and every tool — goes through the harness-injected executor,
**never** a Codex-native read/fetch path. That plan ships a negative certification test
(`codex-native-fetch-intercepted`) asserting a Codex-native fetch is intercepted/denied.

## Recency framing (related, see provider brief)

`read_source` makes the grounded 10-K readable. Post-10-K recency splits by type: **material 8-K events
are grounded** (EDGAR tree, later, as hashed readable documents) while the **web tier stays risk
color** — best-effort context, not decision-grade. This is stated to the model in the `risks`-lane
brief (`packages/workflow/src/researchSwarm.ts`, the `RISKS_RECENCY_NOTE`) and summarized in
`docs/architecture/owlfolio-v2-provider-model-support.md`.
