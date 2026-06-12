import { modelRoleIds, type ModelRoleId } from '@owlfolio/strategies/modelRegistry'

/**
 * Pure validation + (de)serialization for a per-role model override value (`provider:model@temp`), the
 * payload the /settings/providers per-tier selector writes into `OWLFOLIO_MODEL_ROLE_<ROLE>` in the env
 * file. Kept pure so the route stays a thin shell over tested logic. Mirrors the registry resolver's
 * `parseEnvOverride` format exactly: provider:model with an optional @temp suffix.
 */

const VALID_ROLE_IDS: ReadonlySet<string> = new Set(modelRoleIds)

/** True when `role` is an actual registry role id (the whitelist the route enforces). */
export function isValidModelRoleId(role: string): role is ModelRoleId {
  return VALID_ROLE_IDS.has(role)
}

export type ModelRoleOverrideInput = {
  provider_id: string
  model: string
  /** Optional sampling temperature (0–1). Omitted = inherit the registry's low default. */
  temperature?: number
}

// provider/model are single tokens that must not collide with the `:`/`@` delimiters or carry newlines
// (env-file values are single-line). The registry parser splits on the FIRST `:` and the LAST `@`.
const SAFE_TOKEN = /^[^\s:@\r\n][^:@\r\n]*$/

/**
 * Serialize an override into the `provider:model@temp` env value. Validates the provider/model tokens and
 * the temperature range so a malformed selection never reaches the env file. Throws on invalid input.
 */
export function buildModelRoleOverrideValue(input: ModelRoleOverrideInput): string {
  const provider = input.provider_id.trim()
  const model = input.model.trim()
  if (provider.length === 0) throw new Error('A provider is required for a model-role override.')
  if (model.length === 0) throw new Error('A model is required for a model-role override.')
  if (!SAFE_TOKEN.test(provider)) throw new Error('Provider must not contain spaces, ":", "@", or newlines.')
  if (!SAFE_TOKEN.test(model)) throw new Error('Model must not contain ":", "@", or newlines.')

  let value = `${provider}:${model}`
  if (input.temperature !== undefined) {
    const t = input.temperature
    if (!Number.isFinite(t) || t < 0 || t > 1) {
      throw new Error('Temperature must be a number between 0 and 1.')
    }
    value += `@${t}`
  }
  return value
}

/** Parse a `provider:model@temp` value back into its parts (inverse of {@link buildModelRoleOverrideValue}). */
export function parseModelRoleOverrideValue(raw: string): ModelRoleOverrideInput {
  let rest = raw.trim()
  let temperature: number | undefined
  const at = rest.lastIndexOf('@')
  if (at >= 0) {
    const t = Number(rest.slice(at + 1).trim())
    if (Number.isFinite(t)) temperature = t
    rest = rest.slice(0, at).trim()
  }
  const colon = rest.indexOf(':')
  const provider_id = colon >= 0 ? rest.slice(0, colon).trim() : ''
  const model = colon >= 0 ? rest.slice(colon + 1).trim() : rest
  return { provider_id, model, ...(temperature === undefined ? {} : { temperature }) }
}
