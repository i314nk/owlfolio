// Curated REASONING-MODEL catalog — a VERSIONED, deliberately SHORT, per-provider list of models that
// the swarm role-selectors can suggest. OWNER REQUIREMENT: only reasoning/thinking-capable models are
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
// invent exotic ids. NOTE: openai-api's catalog default `gpt-4.1-mini` is NOT reasoning-capable, so the
// curated openai-api default is upgraded to a reasoning model and the legacy id is deliberately omitted.

import type { ProviderId } from '@owlfolio/shared'

/** Bump on every change to the curated lists below. */
export const CURATED_MODEL_CATALOG_VERSION = 'curated-models-2026-06-1' as const

export type ModelTierSuitability = 'T1' | 'T2' | 'T3'

export type CuratedModel = {
  model_id: string
  /**
   * OWNER INVARIANT: always `true`. The type pins it to the literal so a non-reasoning entry is a type
   * error, not just a lint miss — judgment-heavy roles must run on thinking-enabled models.
   */
  reasoning: true
  /**
   * Which tiers this model is a reasonable suggestion for. EMPTY only for the demo-only mock model, which
   * is excluded from real-tier suggestions.
   */
  tier_suitability: ModelTierSuitability[]
  /** One honest line: capability/cost posture and any caveat. */
  note: string
  /** True for the deterministic demo model — present for completeness, never a real-tier suggestion. */
  demo_only?: boolean
}

// Per-provider curated lists. SHORT by design. Ordered best-first within a provider.
const CURATED_MODELS: Partial<Record<ProviderId, CuratedModel[]>> = {
  // Deterministic demo provider — listed for completeness, excluded from real-tier suggestions.
  'mock-provider': [
    {
      model_id: 'mock-buffett-munger-demo',
      reasoning: true,
      tier_suitability: [],
      note: 'Deterministic demo/e2e fixture only — never a live research suggestion.',
      demo_only: true,
    },
  ],
  // Anthropic Claude — all current models are thinking-enabled (adaptive thinking).
  claude: [
    { model_id: 'claude-opus-4-8', reasoning: true, tier_suitability: ['T1'], note: 'Frontier reasoning (adaptive thinking) — best for synthesis and the highest-stakes lanes.' },
    { model_id: 'claude-sonnet-4-6', reasoning: true, tier_suitability: ['T1', 'T2'], note: 'Strong reasoning at lower cost (adaptive thinking) — frontier lanes or mid-tier cross-check.' },
    { model_id: 'claude-haiku-4-5', reasoning: true, tier_suitability: ['T3'], note: 'Fast/cheap with thinking — fine for T3 monitors/entity resolution; not a frontier-lane choice.' },
  ],
  // OpenAI Codex CLI surface — gpt-5.5 is the reasoning anchor.
  openai: [
    { model_id: 'gpt-5.5', reasoning: true, tier_suitability: ['T1', 'T2'], note: 'Reasoning model behind the Codex CLI — frontier synthesis or mid-tier cross-check.' },
  ],
  // Direct OpenAI API — upgrade off the non-reasoning gpt-4.1-mini default to a reasoning model.
  'openai-api': [
    { model_id: 'gpt-5.5', reasoning: true, tier_suitability: ['T1', 'T2'], note: 'Reasoning model via the direct API. Replaces the non-reasoning gpt-4.1-mini catalog default for judgment-heavy roles.' },
  ],
  // Google Gemini Developer API.
  'gemini-developer-api': [
    { model_id: 'gemini-2.5-pro', reasoning: true, tier_suitability: ['T1', 'T2'], note: 'Gemini reasoning model with grounding/URL context — frontier lanes or mid-tier.' },
  ],
  // OpenRouter meta-aggregator — a SHORT curated set of reasoning routes (per-route certification still
  // required separately). Fewer is better; these are reasoning routes only.
  openrouter: [
    { model_id: 'anthropic/claude-opus-4.8', reasoning: true, tier_suitability: ['T1'], note: 'Claude Opus 4.8 routed via OpenRouter — frontier reasoning.' },
    { model_id: 'openai/gpt-5.5', reasoning: true, tier_suitability: ['T1', 'T2'], note: 'GPT-5.5 routed via OpenRouter — frontier/mid reasoning.' },
    { model_id: 'deepseek/deepseek-r1', reasoning: true, tier_suitability: ['T2', 'T3'], note: 'DeepSeek R1 reasoning route — cost-effective mid/cheap tier.' },
  ],
}

/** The full curated catalog (a deep-enough copy that callers cannot mutate the frozen source). */
export function getCuratedModelCatalog(): Partial<Record<ProviderId, CuratedModel[]>> {
  const out: Partial<Record<ProviderId, CuratedModel[]>> = {}
  for (const [providerId, models] of Object.entries(CURATED_MODELS)) {
    if (models === undefined) continue
    out[providerId as ProviderId] = models.map((model) => ({ ...model, tier_suitability: [...model.tier_suitability] }))
  }
  return out
}

/** Curated reasoning models for one provider (empty if none are curated). */
export function curatedModelsForProvider(providerId: string): CuratedModel[] {
  const models = CURATED_MODELS[providerId as ProviderId]
  if (models === undefined) return []
  return models.map((model) => ({ ...model, tier_suitability: [...model.tier_suitability] }))
}

/** True when `modelId` is a curated reasoning model for `providerId`. */
export function isCuratedModel(providerId: string, modelId: string): boolean {
  return curatedModelsForProvider(providerId).some((model) => model.model_id === modelId)
}

/**
 * Real-tier curated models for a provider, excluding the demo-only mock model — the set a tier selector
 * should suggest. (A model with no `tier_suitability` is demo-only and is dropped.)
 */
export function curatedRealTierModelsForProvider(providerId: string): CuratedModel[] {
  return curatedModelsForProvider(providerId).filter((model) => model.demo_only !== true && model.tier_suitability.length > 0)
}
