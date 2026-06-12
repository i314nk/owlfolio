// Owner-attested DATA POSTURE policy (versioned, dated, PER-ROUTE).
//
// The certification runner used to read a single hardcoded `unknown / not_verified` posture off the
// provider catalog for every OpenRouter route — which permanently capped every routed model at
// `experimental` regardless of the owner's actual account configuration. This module replaces that with
// an EXPLICIT, owner-attested, auditable policy: the owner has configured their OpenRouter account and
// ATTESTS the data posture per route here. It is honest by construction:
//
//   - It records an OWNER-ATTESTED ACCOUNT CONFIGURATION, never a contractual/legal verification. The
//     notes say so explicitly so a downstream report never implies more than the owner attested.
//   - It is FAIL-CLOSED: a route not covered here resolves to `unknown / not_verified` (the prior
//     default), so an unlisted model is never silently upgraded.
//   - It is VERSIONED + DATED (mirroring valuationParams / goldenSet): changing an attestation is a
//     deliberate, logged act — bump `version` and update `attested_at`.
//
// Owner attestation (2026-06-13): the OpenRouter account enforces ZDR-only routing for ALL models
// EXCEPT the Anthropic / OpenAI / Google frontier models. Per OpenRouter's own recommendation those
// frontier models are exempted from ZDR-only and run under the vendors' standard no-training API terms
// (with the vendors' bounded abuse-monitoring retention).

import type { ProviderDataPolicySource, ProviderRetentionOrZdrStatus, ProviderSurfaceId } from './providerContract'

/** The resolved per-route posture the cert runner records + gates on. */
export type ResolvedDataPosture = {
  data_policy_source: ProviderDataPolicySource
  retention_or_zdr_status: ProviderRetentionOrZdrStatus
  /** true ONLY when this exact route is covered by an owner attestation (false = fail-closed default). */
  attested: boolean
  /** Honest human-readable note. Always names the BASIS (owner-attested account config, not a contract). */
  note: string
  /** The policy version that produced this posture (for the report's provenance). */
  policy_version: string
  /** The attestation date (ISO) when covered; the policy's date otherwise. */
  attested_at: string
}

/** One owner attestation: a matcher over (surface, model) → posture. First match wins. */
type DataPostureRule = {
  provider_surface_id: ProviderSurfaceId
  /** Model-id prefixes this rule covers (e.g. 'anthropic/', 'deepseek/'). Empty ⇒ all models on surface. */
  model_prefixes: string[]
  data_policy_source: ProviderDataPolicySource
  retention_or_zdr_status: ProviderRetentionOrZdrStatus
  note: string
}

export type DataPosturePolicy = {
  version: string
  attested_at: string
  attested_by: 'owner'
  rules: DataPostureRule[]
}

/**
 * The owner-attested policy. ORDER MATTERS: the more specific frontier-exemption rules precede the
 * catch-all ZDR rule for the OpenRouter surface so an Anthropic/OpenAI/Google route is matched first.
 */
export const DATA_POSTURE_POLICY: DataPosturePolicy = Object.freeze({
  version: 'data-posture-2026-06-13',
  attested_at: '2026-06-13',
  attested_by: 'owner',
  rules: [
    {
      // Frontier-vendor exemption (OpenRouter-recommended): Anthropic / OpenAI / Google models run under
      // the vendors' standard no-training API terms with bounded abuse-monitoring retention.
      provider_surface_id: 'openrouter-api',
      model_prefixes: ['anthropic/', 'openai/', 'google/'],
      data_policy_source: 'owner_attested_account_policy',
      retention_or_zdr_status: 'vendor_standard_no_training_terms',
      note:
        'Owner-attested OpenRouter account configuration (2026-06-13): this frontier-vendor route is '
        + 'EXEMPTED from ZDR-only per OpenRouter’s recommendation and runs under the vendor’s '
        + 'standard no-training API terms with bounded abuse-monitoring retention. Basis is an owner '
        + 'ACCOUNT CONFIGURATION, not a contractual/legal verification of the vendor terms.',
    },
    {
      // Catch-all for every OTHER OpenRouter route: ZDR-only routing enforced at the account level.
      provider_surface_id: 'openrouter-api',
      model_prefixes: [],
      data_policy_source: 'owner_attested_account_policy',
      retention_or_zdr_status: 'zdr_routing_enforced',
      note:
        'Owner-attested OpenRouter account configuration (2026-06-13): ZDR-only routing is enforced for '
        + 'this route (zero-data-retention providers only). Basis is an owner ACCOUNT CONFIGURATION '
        + '(account setting), not a contractual/legal verification.',
    },
  ],
}) as DataPosturePolicy

const FAIL_CLOSED: Omit<ResolvedDataPosture, 'policy_version' | 'attested_at'> = {
  data_policy_source: 'unknown',
  retention_or_zdr_status: 'not_verified',
  attested: false,
  note: 'No owner attestation covers this route — fail-closed (posture unknown, retention/ZDR not verified).',
}

/**
 * Resolve the owner-attested data posture for a (provider surface, model) route. FAIL-CLOSED: an
 * uncovered route returns the unknown/not_verified default — never a silent upgrade.
 */
export function resolveDataPosture(
  providerSurfaceId: string,
  modelId: string | undefined,
  policy: DataPosturePolicy = DATA_POSTURE_POLICY,
): ResolvedDataPosture {
  const model = (modelId ?? '').trim().toLowerCase()
  for (const rule of policy.rules) {
    if (rule.provider_surface_id !== providerSurfaceId) continue
    const matchesModel = rule.model_prefixes.length === 0
      || rule.model_prefixes.some((prefix) => model.startsWith(prefix.toLowerCase()))
    if (!matchesModel) continue
    return {
      data_policy_source: rule.data_policy_source,
      retention_or_zdr_status: rule.retention_or_zdr_status,
      attested: true,
      note: rule.note,
      policy_version: policy.version,
      attested_at: policy.attested_at,
    }
  }
  return { ...FAIL_CLOSED, policy_version: policy.version, attested_at: policy.attested_at }
}
