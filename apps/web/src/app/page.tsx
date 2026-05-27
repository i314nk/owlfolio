import { CommandCenter } from '../components/CommandCenter'
import { getDemoCommandCenter } from '../lib/demo'

export default function HomePage() {
  return <CommandCenter dashboard={getDemoCommandCenter()} />
}
