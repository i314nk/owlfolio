import { NextResponse } from 'next/server'

import { SQLiteEventStore } from '@owlfolio/ledger/sqliteEventStore'

import { setEnvKey } from '../../../../lib/envKeys'
import { getOnboardingState } from '../../../../lib/onboarding'
import { llmGroupIdForEnvKey } from '../../../../lib/providerKeys'
import { recordProviderConnectedEvent } from '../../../../lib/providerConnections'

/**
 * Set/update a single local env key. SERVER-ONLY: the raw value is written to
 * the local env file and NEVER returned to the client. For LLM provider keys we
 * also record a `provider_connected` ledger event (provider id + key NAME +
 * timestamp) so "connected" is derived honestly — the secret stays only in the
 * env file. Tool/data keys do not record a connection event.
 */
export async function POST(request: Request): Promise<Response> {
  let name: string
  let value: string
  try {
    const formData = await request.formData()
    name = String(formData.get('name') ?? '').trim()
    value = String(formData.get('value') ?? '')
  } catch {
    return NextResponse.json({ error: 'Invalid form submission' }, { status: 400 })
  }

  if (name.length === 0 || value.trim().length === 0) {
    return NextResponse.json({ error: 'A key name and value are required' }, { status: 400 })
  }

  try {
    await setEnvKey(name, value)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not set the key'
    return NextResponse.json({ error: message }, { status: 400 })
  }

  // Record an honest provider-connected event for LLM keys (no secret in the ledger).
  const llmGroupId = llmGroupIdForEnvKey(name)
  if (llmGroupId !== undefined) {
    const state = await getOnboardingState()
    if (state.config.ledger_path !== undefined) {
      const store = new SQLiteEventStore(state.config.ledger_path)
      try {
        await recordProviderConnectedEvent(store, { provider_id: llmGroupId, env_key_name: name })
      } finally {
        store.close()
      }
    }
  }

  // Redirect back to the keys page so the masked status refreshes (no value echoed).
  return NextResponse.redirect(new URL('/settings/providers', request.url), 303)
}
