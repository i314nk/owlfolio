import { notFound } from 'next/navigation'

import { ResearchCasePanel } from '../../../components/ResearchCasePanel'
import { getDemoResearchCase } from '../../../lib/demo'

export type ResearchCasePageProps = {
  params: Promise<{ caseId: string }>
}

export default async function ResearchCasePage({ params }: ResearchCasePageProps) {
  const { caseId } = await params

  try {
    const researchCase = await getDemoResearchCase(caseId)

    return (
      <main style={{ color: '#0f172a', minHeight: '100vh', padding: '3rem clamp(1rem, 4vw, 4rem)' }}>
        <div style={{ margin: '0 auto', maxWidth: '1040px' }}>
          <p style={{ margin: '0 0 1rem' }}>
            <a href="/" style={{ color: '#047857', fontWeight: 800, textDecoration: 'none' }}>
              ← Back to command center
            </a>
          </p>
          <ResearchCasePanel researchCase={researchCase} />
        </div>
      </main>
    )
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Unknown demo research case:')) {
      notFound()
    }

    throw error
  }
}
