import type { AppConfig } from '@owlfolio/shared'

/**
 * Pure, IO-free selector for the persistent "what mode/provider/model am I in?" indicator.
 *
 * This is DISPLAY ONLY: it never initialises, switches, or mutates anything. It collapses the
 * three-state mode plus provider-connected and capital-set signals into a single discriminated
 * status the nav/header can render unambiguously, with a clickable fix href on every not-ready state.
 *
 * Data-source discipline (the trap S2 must avoid): `providerConnected` and `capitalSet` are SEPARATE,
 * REAL checks resolved by the caller — provider readiness covers the provider, but capital-set comes
 * from the S4 onboarding gate's `investable_capital` missing-item (the ledger `projectInvestableCapital`
 * projection). Do NOT assume readiness implies capital.
 */

export const ACTIVE_MODE_FIX_HREF = '/settings/providers'

export type ActiveModeStatusKind =
  | 'unconfigured'
  | 'demo'
  | 'provider-not-connected'
  | 'capital-not-set'
  | 'ready'

export type ActiveModeStatus = {
  kind: ActiveModeStatusKind
  label: string
  /** Present on every not-ready state; the destination that fixes it. Absent when nothing to fix. */
  href?: string
}

export type ActiveModeStatusInput = {
  mode: AppConfig['mode']
  /** Provider readiness from `getProviderReadinessSnapshot` — is the active provider actually usable. */
  providerConnected: boolean
  /** Capital-set from the S4 gate's `investable_capital` missing-item (ledger projection). */
  capitalSet: boolean
  providerId: string
  modelId: string
}

export function selectActiveModeStatus(input: ActiveModeStatusInput): ActiveModeStatus {
  if (input.mode === 'unconfigured') {
    return {
      kind: 'unconfigured',
      label: 'Not set up — choose a mode',
      href: ACTIVE_MODE_FIX_HREF,
    }
  }

  if (input.mode === 'demo') {
    return {
      kind: 'demo',
      label: 'Demo · mock-provider (sample data)',
    }
  }

  // personal-local from here down.
  if (!input.providerConnected) {
    return {
      kind: 'provider-not-connected',
      label: 'Personal-local · provider not connected',
      href: ACTIVE_MODE_FIX_HREF,
    }
  }

  if (!input.capitalSet) {
    return {
      kind: 'capital-not-set',
      label: 'Personal-local · capital not set',
      href: ACTIVE_MODE_FIX_HREF,
    }
  }

  return {
    kind: 'ready',
    label: `Personal-local · ${input.providerId} / ${input.modelId}`,
  }
}
