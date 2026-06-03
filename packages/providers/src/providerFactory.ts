import type { ProviderId } from '@owlfolio/shared'

import { ClaudeCliProvider, type ClaudeCliProviderOptions } from './claudeCliProvider'
import { GeminiDeveloperApiProvider, type GeminiDeveloperApiProviderOptions } from './geminiDeveloperApiProvider'
import { MockProvider, type MockProviderOptions } from './mockProvider'
import { OpenAIAPIProvider, type OpenAIAPIProviderOptions } from './openaiApiProvider'
import { OpenAICodexCliProvider, type OpenAICodexCliProviderOptions } from './openaiCodexCliProvider'
import type { Provider } from './providerContract'

export type ResolveProviderOptions = ClaudeCliProviderOptions & OpenAICodexCliProviderOptions & OpenAIAPIProviderOptions & GeminiDeveloperApiProviderOptions & {
  provider_id: ProviderId
  mockOptions?: MockProviderOptions
}

export function resolveProvider(options: ResolveProviderOptions): Provider {
  if (options.provider_id === 'mock-provider') {
    return new MockProvider(options.mockOptions)
  }

  if (options.provider_id === 'claude') {
    return new ClaudeCliProvider(options)
  }

  if (options.provider_id === 'openai') {
    return new OpenAICodexCliProvider(options)
  }

  if (options.provider_id === 'openai-api') {
    return new OpenAIAPIProvider(options)
  }

  if (options.provider_id === 'gemini-developer-api') {
    return new GeminiDeveloperApiProvider(options)
  }

  throw new Error(`Unsupported provider: ${options.provider_id}`)
}
