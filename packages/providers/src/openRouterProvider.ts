import type { ZodType } from 'zod'

import type {
  Provider,
  ProviderCapabilities,
  ProviderCompletion,
  ProviderRunRequest,
  ProviderToolRun,
} from './providerContract'

export type OpenRouterProviderOptions = {
  env?: NodeJS.ProcessEnv
  apiKey?: string
  baseUrl?: string
  fetch?: typeof fetch
}

/**
 * OpenRouter is a meta-aggregator that routes one OpenAI-compatible API key to many
 * underlying models/providers. This adapter is intentionally a fail-closed skeleton:
 * it models the pluggable seam and readiness/credential detection, but it must not be
 * presented as certified/live for Owlfolio research until a target-specific certification
 * report exists. Every execution path throws a clear, honest error until then.
 *
 * Because each routed model has its own capabilities and privacy posture, per-model
 * certification is required even after a live call path lands; OpenRouter as a provider
 * cannot be certified provider-wide.
 */
export class OpenRouterProvider implements Provider {
  readonly provider_id = 'openrouter'
  readonly capabilities: ProviderCapabilities = {
    'text-generation': 'adapter',
    'structured-output': 'adapter',
    'tool-function-calling': 'adapter',
    'streaming-observability': 'unsupported',
    'multi-step-tool-loop': 'unsupported',
    'source-grounding': 'unsupported',
    'citation-metadata': 'unsupported',
    'url-context': 'unsupported',
    'file-context': 'unsupported',
    'source-bundle-production': 'unsupported',
    'code-execution': 'unsupported',
    'computer-use': 'unsupported',
    'browser-use': 'unsupported',
  }

  private readonly env: NodeJS.ProcessEnv
  private readonly apiKey: string | undefined
  private readonly baseUrl: string

  constructor(options: OpenRouterProviderOptions = {}) {
    this.env = { ...process.env, ...options.env }
    this.apiKey = options.apiKey ?? this.env.OPENROUTER_API_KEY
    this.baseUrl = (options.baseUrl ?? 'https://openrouter.ai/api/v1').replace(/\/+$/, '')
  }

  /**
   * Returns true only when an OpenRouter API key is present in the environment/options.
   * Readiness is not certification: a present key still leaves the provider fail-closed
   * for research execution until a certification report exists for the routed target.
   */
  isReady(): boolean {
    return this.apiKey !== undefined && this.apiKey.length > 0
  }

  async complete(_request: ProviderRunRequest): Promise<ProviderCompletion> {
    return this.failClosed()
  }

  async structured<T>(_request: ProviderRunRequest, _schema: ZodType<T>): Promise<T> {
    return this.failClosed()
  }

  async runWithTools(_request: ProviderRunRequest): Promise<ProviderToolRun> {
    return this.failClosed()
  }

  private failClosed(): never {
    if (!this.isReady()) {
      throw new Error('OpenRouter is not configured: missing OPENROUTER_API_KEY')
    }

    throw new Error(
      'OpenRouter is not certified for Owlfolio research: a target-specific certification report (per routed model) is required before the OpenRouter execution path is enabled.',
    )
  }
}
