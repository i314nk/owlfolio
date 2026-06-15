'use client'

import type { FormEvent } from 'react'
import { useState } from 'react'
import { useRouter } from 'next/navigation'

import { resolveErrorMessage } from './resolveErrorMessage'

const cardStyle = {
  background: 'var(--owl-color-panel-elevated)',
  border: '1px solid rgba(148, 163, 184, 0.18)',
  borderRadius: '1.25rem',
  boxShadow: '0 20px 45px rgba(0, 0, 0, 0.18)',
  color: '#f7f8ff',
  padding: '1.5rem',
}

const inputStyle = {
  background: 'var(--owl-color-panel-elevated)',
  border: '1px solid rgba(148, 163, 184, 0.28)',
  borderRadius: '0.85rem',
  color: '#f7f8ff',
  fontSize: '1rem',
  padding: '0.8rem 0.9rem',
  width: '100%',
}

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
      <section style={cardStyle}>
        <p style={{ color: '#7c8cff', fontWeight: 800, letterSpacing: '0.08em', margin: 0 }}>OWLFOLIO</p>
        <h1 className="owl-page-title" style={{ lineHeight: 1, margin: '0.5rem 0 1rem' }}>
          Start your first research case
        </h1>
        <p style={{ color: '#cbd5e1', fontSize: '1rem', margin: '0 0 1.5rem' }}>
          Create a durable research-case record in the personal local ledger before any provider analysis runs.
        </p>
        <form onSubmit={(event) => void submit(event)} style={{ display: 'grid', gap: '1rem' }}>
          <label style={{ display: 'grid', gap: '0.4rem', fontWeight: 700 }}>
            <span>Ticker</span>
            <input
              aria-label="Ticker"
              autoComplete="off"
              name="ticker"
              onChange={(event) => setTicker(event.target.value.toUpperCase())}
              placeholder="MSFT"
              style={inputStyle}
              value={ticker}
            />
          </label>
          <label style={{ display: 'grid', gap: '0.4rem', fontWeight: 700 }}>
            <span>Company ID (optional)</span>
            <input
              aria-label="Company ID"
              autoComplete="off"
              name="company_id"
              onChange={(event) => setCompanyId(event.target.value)}
              placeholder="company_msft"
              style={inputStyle}
              value={companyId}
            />
          </label>
          {error === undefined ? null : (
            <p style={{ color: '#fecaca', fontWeight: 700, margin: 0 }}>{error}</p>
          )}
          <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.5rem' }}>
            <button
              disabled={isSubmitting}
              style={{
                background: '#6366f1',
                border: 'none',
                borderRadius: '999px',
                color: '#ffffff',
                cursor: isSubmitting ? 'progress' : 'pointer',
                fontSize: '0.95rem',
                fontWeight: 800,
                padding: '0.8rem 1rem',
              }}
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
