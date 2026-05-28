import { CommandCenter } from '../components/CommandCenter'
import { getDemoCommandCenter } from '../lib/demo'

export default async function HomePage() {
  const dashboard = await getDemoCommandCenter()
  return <CommandCenter dashboard={dashboard} />
}
