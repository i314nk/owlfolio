// Curated REASONING-MODEL catalog — a VERSIONED, deliberately SHORT, per-provider list of models that
// the model picker can suggest. OWNER REQUIREMENT: only reasoning/thinking-capable models are
// curated here, because every swarm role does judgment-heavy work (rubric scoring, adversarial
// red-teaming, synthesis). A non-reasoning model (e.g. a small "mini" completion model) must NEVER appear
// in this catalog.
//
// THESE LISTS GO STALE. Model ids drift as providers ship/retire models — that is why this module is
// VERSIONED (`CURATED_MODEL_CATALOG_VERSION`) and intentionally minimal (fewer, honest entries beat a
// long speculative menu). The free-form selector input remains the escape hatch for an uncurated id; the
// UI warns when one is used ("uncurated model — verify it supports extended reasoning").
//
// This is a SUGGESTION surface only. Presence here asserts NOTHING about certification or qualification —
// those gates live in providerCatalog (`isInvestmentGradeSuitable`) and the golden-set qualification
// report. A curated model is "plausibly reasoning-capable", not "approved for production research".
//
// Anchors are the repo's existing provider defaults (providerCatalog `default_model_id`) — we do not
// invent exotic ids. The two real provider lanes are OpenRouter (all API models behind one key) and the
// Codex CLI (gpt-5.5); the curated OpenRouter routes below are the current-generation reasoning candidate
// menu the picker offers.
//
// EXACT PINNED IDS, NOT ALIASES: every OpenRouter id below is an exact, pinned model id (NOT a drifting
// `~*-latest` alias). Certification is per EXACT target, so an alias that silently drifts under a recorded
// cert would break trust — pin the id, re-certify on bump. Every id here was verified to exist against the
// live OpenRouter model list (https://openrouter.ai/api/v1/models) at the catalog version date.

import type { ProviderId } from '@owlfolio/shared'

/** Bump on every change to the curated lists below. */
export const CURATED_MODEL_CATALOG_VERSION = 'curated-models-2026-07-18' as const

export type CuratedModel = {
  model_id: string
  /**
   * OWNER INVARIANT: always `true`. The type pins it to the literal so a non-reasoning entry is a type
   * error, not just a lint miss — the analysis does judgment-heavy work and must run on a
   * thinking-enabled model.
   */
  reasoning: true
  /** One honest line: capability/cost posture and any caveat. */
  note: string
  /** True for the deterministic demo model — present for completeness, never a real suggestion. */
  demo_only?: boolean
}

// Per-provider curated lists. SHORT by design. Ordered best-first within a provider.
const CURATED_MODELS: Partial<Record<ProviderId, CuratedModel[]>> = {
  // Deterministic demo provider — listed for completeness, excluded from real suggestions.
  'mock-provider': [
    {
      model_id: 'mock-buffett-munger-demo',
      reasoning: true,
      note: 'Deterministic demo/e2e fixture only — never a live research suggestion.',
      demo_only: true,
    },
  ],
  // OpenRouter meta-aggregator — the current-generation reasoning candidate menu (one API key routes to
  // every model). Per-route certification is still required separately. EXACT PINNED IDS (not aliases),
  // each verified live. SHORT by design.
  openrouter: [
    { model_id: 'anthropic/claude-opus-4.8', reasoning: true, note: 'Claude Opus 4.8 — frontier reasoning; best for synthesis and highest-stakes lanes.' },
    { model_id: 'anthropic/claude-fable-5', reasoning: true, note: 'Claude Fable 5 — frontier reasoning, long-context.' },
    { model_id: 'openai/gpt-5.5', reasoning: true, note: 'GPT-5.5 — frontier/mid reasoning.' },
    { model_id: 'google/gemini-3.1-pro-preview', reasoning: true, note: 'Gemini 3.1 Pro — Google frontier reasoning with long context (pinned preview id).' },
    { model_id: 'x-ai/grok-4.3', reasoning: true, note: 'Grok 4.3 — xAI frontier reasoning.' },
    { model_id: 'anthropic/claude-sonnet-4.6', reasoning: true, note: 'Claude Sonnet 4.6 — strong reasoning at lower cost; mid-tier cross-check.' },
    { model_id: 'google/gemini-3.5-flash', reasoning: true, note: 'Gemini 3.5 Flash — cost-aware reasoning for the mid tier.' },
    { model_id: 'qwen/qwen3.7-plus', reasoning: true, note: 'Qwen3.7 Plus — long-context reasoning, cost-aware mid tier.' },
    { model_id: 'deepseek/deepseek-v4-pro', reasoning: true, note: 'DeepSeek V4 Pro — cost-effective frontier reasoning for the mid tier.' },
    { model_id: 'deepseek/deepseek-v4-flash', reasoning: true, note: 'DeepSeek V4 Flash — cheap/high-volume reasoning for monitors.' },
    { model_id: 'qwen/qwen3.6-flash', reasoning: true, note: 'Qwen3.6 Flash — cheap/high-volume reasoning for monitors.' },
    { model_id: 'google/gemini-3.1-flash-lite', reasoning: true, note: 'Gemini 3.1 Flash Lite — cheapest tier for high-volume scanning.' },
  ],
}

/** The full curated catalog (a deep-enough copy that callers cannot mutate the frozen source). */
export function getCuratedModelCatalog(): Partial<Record<ProviderId, CuratedModel[]>> {
  const out: Partial<Record<ProviderId, CuratedModel[]>> = {}
  for (const [providerId, models] of Object.entries(CURATED_MODELS)) {
    if (models === undefined) continue
    out[providerId as ProviderId] = models.map((model) => ({ ...model }))
  }
  return out
}

/** Curated reasoning models for one provider (empty if none are curated). */
export function curatedModelsForProvider(providerId: string): CuratedModel[] {
  const models = CURATED_MODELS[providerId as ProviderId]
  if (models === undefined) return []
  return models.map((model) => ({ ...model }))
}

/** True when `modelId` is a curated reasoning model for `providerId`. */
export function isCuratedModel(providerId: string, modelId: string): boolean {
  return curatedModelsForProvider(providerId).some((model) => model.model_id === modelId)
}

/** Real curated models for a provider, excluding the demo-only mock model. */
export function curatedRealModelsForProvider(providerId: string): CuratedModel[] {
  return curatedModelsForProvider(providerId).filter((model) => model.demo_only !== true)
}
