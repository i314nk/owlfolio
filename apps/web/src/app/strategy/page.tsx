
import { StrategyOverview } from '../../components/StrategyOverview'

export const metadata = {
  title: 'Strategy · Owner’s Manual',
  description: 'The default Buffett 4-Pillar quality-value strategy: pipeline, specialist swarm, moat gate, deterministic FCF valuation with a comps-anchored exit multiple, hard gates, and the two-zone discipline.',
}

export default async function StrategyPage() {
  return (
    <>
      <StrategyOverview />
    </>
  )
}
