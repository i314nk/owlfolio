import { createElement } from 'react'

import { EmptyState, OwlButtonLink, RouteHeader } from './designSystem'

export type UnconfiguredNoticeProps = {
  /** The gated feature/area name, e.g. "Watchlist" or "Portfolio", surfaced in the heading. */
  feature: string
}

/**
 * The first-class "choose a mode to begin" state for an UNCONFIGURED app (the explicit three-state
 * default). It NEVER renders demo data and NEVER a misleading empty configured-workflow view — it
 * steers the user to pick a mode via provider/onboarding setup. Rendered by every mode-branching page
 * before it would otherwise fall through to demo or empty-personal data.
 */
export function UnconfiguredNotice({ feature }: UnconfiguredNoticeProps) {
  return createElement(
    'main',
    { className: 'owl-route-frame' },
    createElement(
      'p',
      { className: 'owl-route-back-row' },
      createElement('a', { className: 'owl-back-link owl-focusable', href: '/' }, '← Back to command center'),
    ),
    createElement(RouteHeader, {
      kicker: 'Owlfolio',
      title: `${feature} — choose a mode to begin`,
      description:
        'This workspace is not set up yet. Choose a mode to begin: explore with demo data, or set up a personal-local workflow. Until then, Owlfolio will not show demo data here.',
    }),
    createElement(EmptyState, {
      title: 'Choose a mode to begin',
      description:
        'Start setup to pick demo mode or a personal-local workflow. Review provider readiness first if you want to connect a local AI assistant.',
      primaryAction: createElement(OwlButtonLink, { href: '/settings/providers' }, 'Continue setup'),
    }),
  )
}
