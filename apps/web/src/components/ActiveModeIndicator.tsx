import { createElement } from 'react'

import type { ActiveModeStatus } from '../lib/activeModeStatus'
import type { ModelSwitcher } from '../lib/resolveModelSwitcher'
import { ActiveModelSwitcher } from './ActiveModelSwitcher'

export type ActiveModeIndicatorProps = {
  status: ActiveModeStatus
  /**
   * When ≥2 models are reachable across connected providers, the indicator becomes an interactive grouped
   * model switcher instead of plain text. Resolved server-side by `resolveModelSwitcher`; absent → the
   * plain status label/link is shown (unconfigured / demo / provider-not-connected / single-model states).
   */
  modelSwitcher?: ModelSwitcher
}

/**
 * Thin presentational indicator for the current mode/provider/model. Renders the pure
 * `selectActiveModeStatus` result: a clickable link to the fix page on every not-ready state
 * (`href` present), or plain text on the ready/demo states. When `modelSwitcher` is provided it upgrades to
 * the interactive `ActiveModelSwitcher` (switch the actively-used model app-wide). DISPLAY (+ model switch)
 * only — no init/mode-change/mutation beyond the active model.
 *
 * Mounted in the app shell so it shows app-wide on every page.
 */
export function ActiveModeIndicator({ status, modelSwitcher }: ActiveModeIndicatorProps) {
  if (modelSwitcher !== undefined) {
    return createElement(ActiveModelSwitcher, { switcher: modelSwitcher })
  }

  const isReady = status.kind === 'ready'
  const tone = isReady ? 'ready' : 'attention'

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
