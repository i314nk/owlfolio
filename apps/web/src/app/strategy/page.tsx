import { StrategyOverview } from '../../components/StrategyOverview'

export const metadata = {
  title: 'Strategy · Owner’s Manual',
  description: 'The default Buffett 4-Pillar quality-value strategy: pipeline, specialist swarm, moat gate, reverse-DCF valuation (market-implied vs judged sustainable growth), hard gates, and position sizing.',
}

export default function StrategyPage() {
  return <StrategyOverview />
}
