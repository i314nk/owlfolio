import type { ProviderId } from '@owlfolio/shared'

import { ClaudeCliProvider, type ClaudeCliProviderOptions } from './claudeCliProvider'
import { MockProvider, type MockProviderOptions } from './mockProvider'
import { OpenAICodexCliProvider, type OpenAICodexCliProviderOptions } from './openaiCodexCliProvider'
import type { Provider } from './providerContract'

export type ResolveProviderOptions = ClaudeCliProviderOptions & OpenAICodexCliProviderOptions & {
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

  throw new Error(`Unsupported provider: ${options.provider_id}`)
}
