import { createElement } from 'react'

import { EmptyState, OwlButtonLink, RouteHeader } from './designSystem'

export type UnconfiguredNoticeProps = {
  /** The gated feature/area name, e.g. "Watchlist" or "Portfolio", surfaced in the heading. */
  feature: string
}

/**
 * The first-class "connect a provider to begin" state for an UNCONFIGURED app. It NEVER renders a
 * misleading empty configured-workflow view — it steers the user to set up a personal-local workflow
 * via provider/onboarding setup. Rendered by every gated page before it would otherwise fall through
 * to empty-personal data.
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
      kicker: 'Owner’s Manual',
      title: `${feature} — connect a provider to begin`,
      description:
        'This workspace is not set up yet. Connect a provider to set up a personal-local workflow. Until then, Owner’s Manual will not show any data here.',
    }),
    createElement(EmptyState, {
      title: 'Connect a provider to begin',
      description:
        'Start setup to configure a personal-local workflow. Review provider readiness first if you want to connect a local AI assistant.',
      primaryAction: createElement(OwlButtonLink, { href: '/settings/providers' }, 'Continue setup'),
    }),
  )
}
