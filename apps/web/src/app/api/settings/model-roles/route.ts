import { NextResponse } from 'next/server'

import { MODEL_ROLE_TIER, modelRoleIds, type ModelRoleId } from '@owlfolio/strategies/modelRegistry'

import { removeEnvKey, setEnvKey } from '../../../../lib/envKeys'
import { modelRoleEnvKeyForRole } from '../../../../lib/modelRoleEnv'
import { buildModelRoleOverrideValue, isValidModelRoleId } from '../../../../lib/modelRoleConfig'

const TIERS = new Set(['T1', 'T2', 'T3'])

/**
 * Set/clear a model override for the /settings/providers per-tier selector. SERVER-ONLY: the override
 * (provider:model@temp) is written to / removed from `OWLFOLIO_MODEL_ROLE_<ROLE>` in the local env file
 * via envKeys. The page posts a `tier` (T1/T2/T3) — the choice fans out to EVERY registry role mapped to
 * that tier (MODEL_ROLE_TIER). A single `role` is still accepted for back-compat. The value is validated
 * to the registry's `provider:model@temp` format before any write, so a malformed selection can never
 * reach the env file. "Clear" restores the default-inherit (no env entry → inherit the run's provider/model).
 * This route handles ONLY the role-override env keys, never provider secrets.
 */
export async function POST(request: Request): Promise<Response> {
  let action: string
  let tier: string
  let role: string
  let provider: string
  let model: string
  let temperatureRaw: string
  try {
    const formData = await request.formData()
    action = String(formData.get('action') ?? '').trim()
    tier = String(formData.get('tier') ?? '').trim()
    role = String(formData.get('role') ?? '').trim()
    provider = String(formData.get('provider') ?? '').trim()
    model = String(formData.get('model') ?? '').trim()
    temperatureRaw = String(formData.get('temperature') ?? '').trim()
  } catch {
    return NextResponse.json({ error: 'Invalid form submission' }, { status: 400 })
  }

  // Resolve the target roles: a tier fans out to all of its roles; otherwise a single validated role.
  let targetRoles: ModelRoleId[]
  if (tier.length > 0) {
    if (!TIERS.has(tier)) {
      return NextResponse.json({ error: `Unknown tier: ${tier}` }, { status: 400 })
    }
    targetRoles = modelRoleIds.filter((roleId) => MODEL_ROLE_TIER[roleId] === tier)
  } else if (isValidModelRoleId(role)) {
    targetRoles = [role]
  } else {
    return NextResponse.json({ error: `Unknown model role: ${role}` }, { status: 400 })
  }

  try {
    if (action === 'clear') {
      for (const roleId of targetRoles) {
        await removeEnvKey(modelRoleEnvKeyForRole(roleId))
      }
    } else if (action === 'set') {
      const value = buildModelRoleOverrideValue({
        provider_id: provider,
        model,
        ...(temperatureRaw.length === 0 ? {} : { temperature: Number(temperatureRaw) }),
      })
      for (const roleId of targetRoles) {
        await setEnvKey(modelRoleEnvKeyForRole(roleId), value)
      }
    } else {
      return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 })
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not update the model tier'
    return NextResponse.json({ error: message }, { status: 400 })
  }

  // Redirect back to the keys page so the resolved-from/source columns refresh.
  return NextResponse.redirect(new URL('/settings/providers', request.url), 303)
}
