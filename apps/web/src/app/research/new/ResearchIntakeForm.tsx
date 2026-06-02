'use client'

import type { FormEvent } from 'react'
import { useState } from 'react'
import { useRouter } from 'next/navigation'

const shellStyle = {
  background: 'linear-gradient(135deg, #f8fafc 0%, #ecfdf5 100%)',
  color: '#0f172a',
  minHeight: '100vh',
  padding: '3rem clamp(1rem, 4vw, 4rem)',
}

const cardStyle = {
  background: '#ffffff',
  border: '1px solid #dbeafe',
  borderRadius: '1.25rem',
  boxShadow: '0 20px 45px rgba(15, 23, 42, 0.08)',
  padding: '1.5rem',
}

const inputStyle = {
  border: '1px solid #cbd5e1',
  borderRadius: '0.85rem',
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
        setError(typeof body.error === 'string' ? body.error : 'Unable to create research case')
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
    <main style={shellStyle}>
      <div style={{ margin: '0 auto', maxWidth: '760px' }}>
        <p style={{ margin: '0 0 1rem' }}>
          <a href="/" style={{ color: '#047857', fontWeight: 800, textDecoration: 'none' }}>
            ← Back to command center
          </a>
        </p>
        <section style={cardStyle}>
          <p style={{ color: '#047857', fontWeight: 800, letterSpacing: '0.08em', margin: 0 }}>OWLFOLIO</p>
          <h1 style={{ fontSize: 'clamp(2rem, 5vw, 3.5rem)', lineHeight: 1, margin: '0.5rem 0 1rem' }}>
            Start your first research case
          </h1>
          <p style={{ color: '#475569', fontSize: '1rem', margin: '0 0 1.5rem' }}>
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
              <p style={{ color: '#b91c1c', fontWeight: 700, margin: 0 }}>{error}</p>
            )}
            <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.5rem' }}>
              <button
                disabled={isSubmitting}
                style={{
                  background: '#047857',
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
      </div>
    </main>
  )
}
