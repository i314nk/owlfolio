import { createElement } from 'react'

import type { ActiveModeStatus } from '../lib/activeModeStatus'

export type ActiveModeIndicatorProps = {
  status: ActiveModeStatus
}

/**
 * Thin presentational indicator for the current mode/provider/model. Renders the pure
 * `selectActiveModeStatus` result: a clickable link to the fix page on every not-ready state
 * (`href` present), or plain text on the ready/demo states. DISPLAY ONLY — no init/switch/mutation.
 *
 * Mounted in the app shell so it shows app-wide on every page.
 */
export function ActiveModeIndicator({ status }: ActiveModeIndicatorProps) {
  const isReady = status.kind === 'ready'
  const isDemo = status.kind === 'demo'
  const tone = isReady ? 'ready' : isDemo ? 'demo' : 'attention'

  const content = createElement('span', { className: 'owl-active-mode-label' }, status.label)

  const sharedProps = {
    'aria-label': `Active workspace: ${status.label}`,
    className: `owl-active-mode owl-active-mode-${tone}`,
    'data-active-mode-kind': status.kind,
  }

  if (status.href !== undefined) {
    return createElement(
      'a',
      {
        ...sharedProps,
        className: `${sharedProps.className} owl-focusable`,
        href: status.href,
      },
      createElement('span', { className: 'owl-active-mode-kicker' }, 'Workspace'),
      content,
    )
  }

  return createElement(
    'span',
    sharedProps,
    createElement('span', { className: 'owl-active-mode-kicker' }, 'Workspace'),
    content,
  )
}
