import { resolveLocale } from '@owlfolio/shared'

import { StrategyOverview } from '../../components/StrategyOverview'
import { englishContentNote } from '../../lib/i18n'
import { getOnboardingState } from '../../lib/onboarding'

export const metadata = {
  title: 'Strategy · Owner’s Manual',
  description: 'The default Buffett 4-Pillar quality-value strategy: pipeline, specialist swarm, moat gate, reverse-DCF valuation (market-implied vs judged sustainable growth), hard gates, and position sizing.',
}

export default async function StrategyPage() {
  const note = englishContentNote(resolveLocale((await getOnboardingState()).config.language))
  return (
    <>
      {note === undefined ? null : (
        <p data-testid="english-content-note" dir="rtl" className="owl-row-helper" style={{ border: '1px solid var(--owl-color-border)', borderRadius: '0.6rem', margin: '1rem 1rem 0', padding: '0.6rem 0.8rem' }}>
          {note}
        </p>
      )}
      <StrategyOverview />
    </>
  )
}
