'use client'

import type { FormEvent } from 'react'
import { useState } from 'react'
import { useRouter } from 'next/navigation'

import { resolveErrorMessage } from './resolveErrorMessage'

export function ResearchIntakeForm() {
  const [ticker, setTicker] = useState('')
  const [companyId, setCompanyId] = useState('')
  const [error, setError] = useState<string | undefined>()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const router = useRouter()

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const formData = new FormData(event.currentTarget)
    const submittedTicker = String(formData.get('ticker') ?? '').trim().toUpperCase()
    const submittedCompanyId = String(formData.get('company_id') ?? '').trim()

    setTicker(submittedTicker)
    setCompanyId(submittedCompanyId)
    setIsSubmitting(true)
    setError(undefined)

    try {
      const response = await fetch('/api/research/start', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ticker: submittedTicker, company_id: submittedCompanyId || undefined }),
      })
      const body = await response.json()

      if (!response.ok) {
        setError(resolveErrorMessage(body))
        return
      }

      router.push(`/research/${body.research_case_id}`)
      router.refresh()
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Unable to create research case')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <main className="owl-route-frame owl-route-frame-narrow">
      <p className="owl-route-back-row">
        <a className="owl-back-link owl-focusable" href="/">
          ← Back to command center
        </a>
      </p>
      <section aria-label="Start a research case" className="owl-section-card" style={{ gap: 'var(--owl-space-3)' }}>
        <p className="owl-section-accent" style={{ margin: 0 }}>
          Research intake
        </p>
        <h1 className="owl-page-title" style={{ lineHeight: 1.1, margin: 0 }}>
          Start a research case
        </h1>
        <p className="owl-row-helper" style={{ margin: 0, maxWidth: '42rem' }}>
          Create a durable research-case record in the personal local ledger before any provider analysis runs.
        </p>
        <form onSubmit={(event) => void submit(event)} style={{ display: 'grid', gap: 'var(--owl-space-3)' }}>
          <label style={{ color: 'var(--owl-color-text)', display: 'grid', gap: '0.4rem', fontWeight: 700 }}>
            <span>Ticker</span>
            <input
              aria-label="Ticker"
              autoComplete="off"
              className="owl-input owl-focusable"
              name="ticker"
              onChange={(event) => setTicker(event.target.value.toUpperCase())}
              placeholder="MSFT"
              value={ticker}
            />
          </label>
          <label style={{ color: 'var(--owl-color-text)', display: 'grid', gap: '0.4rem', fontWeight: 700 }}>
            <span>Company ID (optional)</span>
            <input
              aria-label="Company ID"
              autoComplete="off"
              className="owl-input owl-focusable"
              name="company_id"
              onChange={(event) => setCompanyId(event.target.value)}
              placeholder="company_msft"
              value={companyId}
            />
          </label>
          {error === undefined ? null : (
            <p style={{ color: 'var(--owl-color-risk-bright)', fontWeight: 700, margin: 0 }}>{error}</p>
          )}
          <div style={{ display: 'flex', gap: '0.75rem' }}>
            <button
              className="owl-button owl-button-primary owl-focusable"
              disabled={isSubmitting}
              style={{ cursor: isSubmitting ? 'progress' : 'pointer' }}
              type="submit"
            >
              {isSubmitting ? 'Creating…' : 'Create research case'}
            </button>
          </div>
        </form>
      </section>
    </main>
  )
}
