'use client'

import { useEffect } from 'react'

/**
 * A tiny client island that wires every `[data-owl-copy]` button on the keys
 * page to the clipboard. The copied value is always a terminal command (e.g.
 * `codex login`) — never a secret. Keeping this isolated lets the page stay a
 * server component.
 */
export function ProviderKeysCopyScript() {
  useEffect(() => {
    function onClick(event: MouseEvent) {
      const target = event.target
      if (!(target instanceof HTMLElement)) {
        return
      }
      const button = target.closest('[data-owl-copy]')
      if (!(button instanceof HTMLElement)) {
        return
      }
      const value = button.getAttribute('data-owl-copy')
      if (value === null || value.length === 0) {
        return
      }
      void navigator.clipboard?.writeText(value)
      const original = button.textContent
      button.textContent = 'Copied'
      window.setTimeout(() => {
        button.textContent = original
      }, 1200)
    }

    document.addEventListener('click', onClick)
    return () => document.removeEventListener('click', onClick)
  }, [])

  return null
}
