'use client'

import { useEffect } from 'react'

/**
 * A tiny client island for the keys page. It wires:
 *  - every `[data-owl-copy]` button to the clipboard (the copied value is always a terminal command
 *    like `codex login` — never a secret); and
 *  - the `[data-owl-refresh]` button to a page reload, which re-runs the server-side readiness check
 *    (the page is force-dynamic) after the user signs in / sets a key in their terminal.
 * Keeping this isolated lets the page stay a server component.
 */
export function ProviderKeysCopyScript() {
  useEffect(() => {
    function onClick(event: MouseEvent) {
      const target = event.target
      if (!(target instanceof HTMLElement)) {
        return
      }
      // Refresh control: re-resolve every login/key status by reloading the force-dynamic page.
      if (target.closest('[data-owl-refresh]') instanceof HTMLElement) {
        window.location.reload()
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
