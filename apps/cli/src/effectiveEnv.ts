// Readiness/credential checks must see keys the user stored in ~/.owlfolio/.env (via setEnvKey),
// not just process.env — otherwise `status`/`doctor` would report "not ready" immediately after a
// key was saved. This overlays the stored env file on top of the ambient env.
import { readAllEnvKeys } from '@owlfolio/onboarding/envKeys'

export async function effectiveEnv(env: NodeJS.ProcessEnv): Promise<NodeJS.ProcessEnv> {
  return { ...env, ...(await readAllEnvKeys({ env })) }
}
