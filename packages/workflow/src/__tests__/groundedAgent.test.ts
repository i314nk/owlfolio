import { describe, expect, it } from 'vitest'

import { ProposedSourcesSchema } from '../groundedAgent'

describe('ProposedSourcesSchema tolerance (live find: Kimi K2 killed a run on a partial entry)', () => {
  it('salvages entries with a usable url (fills display fields) and drops url-less entries', () => {
    const parsed = ProposedSourcesSchema.parse([
      { source_id: 's1' }, // no url → ungroundable → dropped (the Kimi failure shape)
      { url: 'https://www.sec.gov/x/10k.htm' }, // url only → salvaged with filled display fields
      { source_id: 's3', title: 'Full', url: 'https://www.sec.gov/x/8k.htm', excerpt: 'e' },
    ])
    expect(parsed).toHaveLength(2)
    expect(parsed[0]).toMatchObject({ url: 'https://www.sec.gov/x/10k.htm' })
    expect(parsed[0]!.title.length).toBeGreaterThan(0)
    expect(parsed[0]!.excerpt.length).toBeGreaterThan(0)
    expect(parsed[0]!.source_id.length).toBeGreaterThan(0)
    expect(parsed[1]).toMatchObject({ source_id: 's3', title: 'Full' })
  })

  it('still fails when NOTHING is salvageable (no groundable source is a real failure)', () => {
    expect(ProposedSourcesSchema.safeParse([{ source_id: 'only-id-no-url' }]).success).toBe(false)
  })
})
