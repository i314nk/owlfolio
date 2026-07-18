import { describe, expect, it } from 'vitest'

import { recordedThesis } from '../thesisDisplay'

describe('recordedThesis', () => {
  it('returns a real thesis unchanged', () => {
    expect(recordedThesis('Microsoft is a compounding fortress.')).toBe('Microsoft is a compounding fortress.')
  })

  it('treats the model pre-source draft placeholder as unrecorded', () => {
    expect(recordedThesis('Will formulate after reading source material')).toBeUndefined()
    expect(recordedThesis('To be formulated once the 10-K is read')).toBeUndefined()
  })

  it('treats blank and undefined as unrecorded', () => {
    expect(recordedThesis('   ')).toBeUndefined()
    expect(recordedThesis('')).toBeUndefined()
    expect(recordedThesis(undefined)).toBeUndefined()
  })
})
