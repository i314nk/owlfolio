import { WatchlistPanel } from '../../components/WatchlistPanel'
import { getDemoWatchlistItems } from '../../lib/demo'

export default function WatchlistPage() {
  return (
    <main style={{ color: '#0f172a', minHeight: '100vh', padding: '3rem clamp(1rem, 4vw, 4rem)' }}>
      <div style={{ margin: '0 auto', maxWidth: '1040px' }}>
        <p style={{ margin: '0 0 1rem' }}>
          <a href="/" style={{ color: '#047857', fontWeight: 800, textDecoration: 'none' }}>
            ← Back to command center
          </a>
        </p>
        <WatchlistPanel items={getDemoWatchlistItems()} />
      </div>
    </main>
  )
}
