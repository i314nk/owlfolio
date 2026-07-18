import type { AppConfig } from '@owlfolio/shared'

/**
 * Pure, IO-free selector for the persistent "what mode/provider/model am I in?" indicator.
 *
 * This is DISPLAY ONLY: it never initialises, switches, or mutates anything. It collapses the
 * mode plus the provider-connected signal into a single discriminated status the nav/header can
 * render unambiguously, with a clickable fix href on every not-ready state.
 *
 * SCALE-DOWN: the capital-set state is gone — the investable-capital gate item was retired with the
 * money layer, so the only personal-local blocker is provider connection.
 */

export const ACTIVE_MODE_FIX_HREF = '/settings/providers'

export type ActiveModeStatusKind =
  | 'unconfigured'
  | 'provider-not-connected'
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
  providerId: string
  modelId: string
}

export function selectActiveModeStatus(input: ActiveModeStatusInput): ActiveModeStatus {
  if (input.mode === 'unconfigured') {
    return {
      kind: 'unconfigured',
      label: 'No provider configured',
      href: ACTIVE_MODE_FIX_HREF,
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

  return {
    kind: 'ready',
    label: `Personal-local · ${input.providerId} / ${input.modelId}`,
  }
}
