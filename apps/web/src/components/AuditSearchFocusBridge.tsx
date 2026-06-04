'use client'

import { useEffect } from 'react'

export function AuditSearchFocusBridge({ focusSearchInput }: { focusSearchInput: boolean }) {
  useEffect(() => {
    if (!focusSearchInput) {
      return
    }

    const focusSearchInputElement = () => {
      const searchInput = document.getElementById('audit-search-query')
      if (searchInput instanceof HTMLInputElement) {
        searchInput.focus()
        searchInput.select()
      }
    }

    const timer = window.setTimeout(focusSearchInputElement, 0)
    return () => {
      window.clearTimeout(timer)
    }
  }, [focusSearchInput])

  return null
}
