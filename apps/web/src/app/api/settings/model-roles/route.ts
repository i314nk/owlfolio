import { NextResponse } from 'next/server'

import { removeEnvKey, setEnvKey } from '../../../../lib/envKeys'
import { modelRoleEnvKeyForRole } from '../../../../lib/modelRoleEnv'
import { buildModelRoleOverrideValue, isValidModelRoleId } from '../../../../lib/modelRoleConfig'

/**
 * Set/clear a per-role model override for the /settings/providers per-tier selector. SERVER-ONLY: the
 * override (provider:model@temp) is written to / removed from `OWLFOLIO_MODEL_ROLE_<ROLE>` in the local
 * env file via envKeys. The role is validated against the registry whitelist and the value is validated
 * to the registry's `provider:model@temp` format before any write, so a malformed selection can never
 * reach the env file. "Clear" restores the default-inherit (no env entry → the registry inherits the
 * run's provider/model). This route handles ONLY the role-override env keys, never provider secrets.
 */
export async function POST(request: Request): Promise<Response> {
  let action: string
  let role: string
  let provider: string
  let model: string
  let temperatureRaw: string
  try {
    const formData = await request.formData()
    action = String(formData.get('action') ?? '').trim()
    role = String(formData.get('role') ?? '').trim()
    provider = String(formData.get('provider') ?? '').trim()
    model = String(formData.get('model') ?? '').trim()
    temperatureRaw = String(formData.get('temperature') ?? '').trim()
  } catch {
    return NextResponse.json({ error: 'Invalid form submission' }, { status: 400 })
  }

  if (!isValidModelRoleId(role)) {
    return NextResponse.json({ error: `Unknown model role: ${role}` }, { status: 400 })
  }

  const envKeyName = modelRoleEnvKeyForRole(role)

  try {
    if (action === 'clear') {
      await removeEnvKey(envKeyName)
    } else if (action === 'set') {
      const value = buildModelRoleOverrideValue({
        provider_id: provider,
        model,
        ...(temperatureRaw.length === 0 ? {} : { temperature: Number(temperatureRaw) }),
      })
      await setEnvKey(envKeyName, value)
    } else {
      return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 })
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not update the model role'
    return NextResponse.json({ error: message }, { status: 400 })
  }

  // Redirect back to the keys page so the resolved-from/source columns refresh.
  return NextResponse.redirect(new URL('/settings/providers', request.url), 303)
}
