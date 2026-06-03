import { createElement } from 'react'

export type StatusBadgeTone =
  | 'neutral'
  | 'success'
  | 'warning'
  | 'danger'
  | 'certified'
  | 'experimental'
  | 'blocked'
  | 'draft'
  | 'manual'
  | 'compliance'

export type StatusBadgeProps = {
  children?: string
  tone?: StatusBadgeTone
}

export function StatusBadge({ children, tone = 'neutral' }: StatusBadgeProps) {
  return createElement(
    'span',
    {
      className: `owl-status-pill owl-status-${tone}`,
    },
    children,
  )
}
