import { describe, expect, it } from 'vitest'

import { resolveErrorMessage } from './resolveErrorMessage'

describe('resolveErrorMessage', () => {
  it('renders the specific axis-named reason for an object-shaped out_of_circle error', () => {
    // The /api/research/start circle gate returns an OBJECT error whose message names WHICH axis
    // (sector / size / archetype / market-cap) rejected the candidate. The old code only handled string
    // errors, so this fell through to the generic message and the user never saw the reason.
    const body = {
      error: {
        code: 'out_of_circle',
        message: 'Out of circle of competence: SIC 2834 is outside the allowed SIC prefixes (73)',
      },
    }
    expect(resolveErrorMessage(body)).toBe(
      'Out of circle of competence: SIC 2834 is outside the allowed SIC prefixes (73)',
    )
  })

  it('still renders a bare string error', () => {
    expect(resolveErrorMessage({ error: 'Ticker is required' })).toBe('Ticker is required')
  })

  it('falls back to a generic message when no usable error is present', () => {
    expect(resolveErrorMessage({})).toBe('Unable to create research case')
    expect(resolveErrorMessage({ error: {} })).toBe('Unable to create research case')
    expect(resolveErrorMessage(null)).toBe('Unable to create research case')
  })
})
