import type { ProviderId } from '@owlfolio/shared'

import { MockProvider, type MockProviderOptions } from './mockProvider'
import { OpenRouterProvider, type OpenRouterProviderOptions } from './openRouterProvider'
import type { Provider } from './providerContract'

export type ResolveProviderOptions = OpenRouterProviderOptions & {
  provider_id: ProviderId
  mockOptions?: MockProviderOptions
}

export function resolveProvider(options: ResolveProviderOptions): Provider {
  if (options.provider_id === 'mock-provider') {
    return new MockProvider(options.mockOptions)
  }

  if (options.provider_id === 'openrouter') {
    return new OpenRouterProvider(options)
  }

  // Direct OpenAI-compatible API surfaces (key path) — the generalized OpenAI-compatible adapter pointed at
  // each vendor's `/chat/completions` endpoint with its own key. `reasoningBody: {}` omits OpenRouter's
  // unified `reasoning` param (these endpoints reject unknown params).
  if (options.provider_id === 'openai-api') {
    return new OpenRouterProvider({
      ...options, providerId: 'openai-api', label: 'OpenAI', apiKeyEnvVar: 'OPENAI_API_KEY',
      baseUrl: 'https://api.openai.com/v1', surfaceId: 'openai-api', vendorId: 'openai', reasoningBody: {}, extraHeaders: {},
    })
  }

  if (options.provider_id === 'anthropic-api') {
    return new OpenRouterProvider({
      ...options, providerId: 'anthropic-api', label: 'Anthropic', apiKeyEnvVar: 'ANTHROPIC_API_KEY',
      baseUrl: 'https://api.anthropic.com/v1', surfaceId: 'anthropic-api', vendorId: 'anthropic', reasoningBody: {}, extraHeaders: {},
    })
  }

  if (options.provider_id === 'gemini-developer-api') {
    return new OpenRouterProvider({
      ...options, providerId: 'gemini-developer-api', label: 'Gemini', apiKeyEnvVar: 'GEMINI_API_KEY',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', surfaceId: 'gemini-developer-api', vendorId: 'google', reasoningBody: {}, extraHeaders: {},
    })
  }

  throw new Error(`Unsupported provider: ${options.provider_id}`)
}
