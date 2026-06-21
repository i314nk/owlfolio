import { StrategyOverview } from '../../components/StrategyOverview'

export const metadata = {
  title: 'Strategy · Owlfolio',
  description: 'The default Buffett-Munger quality-value strategy: pipeline, specialist swarm, moat gate, reverse-DCF valuation (market-implied vs judged sustainable growth), hard gates, and position sizing.',
}

export default function StrategyPage() {
  return <StrategyOverview />
}
