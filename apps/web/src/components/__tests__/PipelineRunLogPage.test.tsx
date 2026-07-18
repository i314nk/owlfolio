import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

describe('PipelineRunLogPage source', () => {
  const source = readFileSync('apps/web/src/app/pipeline/run-log/[caseId]/page.tsx', 'utf8')

  it('reads only the selected run window via the redacting runLogs helper', () => {
    expect(source).toContain('runLogTailsForWindow')
    expect(source).toContain('process_research_queue')
    expect(source).toContain('process_deep_dive_queue')
    // Redaction lives in runLogs.ts — the page must not read log files directly.
    expect(source).not.toContain('readFileSync')
    expect(source).not.toContain("from 'node:fs'")
  })

  it('keeps the honest rails: back link, empty state, and the onboarding gate', () => {
    expect(source).toContain('Back to the pipeline')
    expect(source).toContain('/pipeline?case=')
    expect(source).toContain("t(locale, 'pp_log_none')")
    expect(source).toContain('isUnconfiguredForUser')
  })
})
