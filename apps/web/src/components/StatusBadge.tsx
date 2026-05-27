import { createElement, type CSSProperties } from 'react'

export type StatusBadgeTone = 'neutral' | 'success' | 'warning'

export type StatusBadgeProps = {
  children?: string
  tone?: StatusBadgeTone
}

const toneStyles: Record<StatusBadgeTone, CSSProperties> = {
  neutral: {
    background: '#e0f2fe',
    color: '#075985',
  },
  success: {
    background: '#dcfce7',
    color: '#166534',
  },
  warning: {
    background: '#fef3c7',
    color: '#92400e',
  },
}

export function StatusBadge({ children, tone = 'neutral' }: StatusBadgeProps) {
  return createElement(
    'span',
    {
      style: {
        ...toneStyles[tone],
        borderRadius: '999px',
        display: 'inline-flex',
        fontSize: '0.78rem',
        fontWeight: 700,
        padding: '0.35rem 0.65rem',
      },
    },
    children,
  )
}
