import { execFile } from 'node:child_process'
import { z, type ZodType } from 'zod'

import type {
  Provider,
  ProviderCompletion,
  ProviderObservation,
  ProviderRunMetadata,
  ProviderRunRequest,
  ProviderToolRun,
} from './providerContract'

export type CommandRunResult = {
  exitCode: number
  stdout: string
  stderr: string
}

export type CommandRunner = (
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  timeoutMs: number,
) => Promise<CommandRunResult>

export type ClaudeCliProviderOptions = {
  env?: NodeJS.ProcessEnv
  command?: string
  runCommand?: CommandRunner
}

const defaultRunner: CommandRunner = (command, args, env, timeoutMs) => new Promise((resolve, reject) => {
  execFile(command, args, { env, timeout: timeoutMs, maxBuffer: 2 * 1024 * 1024 }, (error, stdout, stderr) => {
    if (error !== null) {
      const exitCode = typeof error.code === 'number' ? error.code : -1
      if ('code' in error && error.code === 'ENOENT') {
        reject(new Error(`Claude CLI not available: ${command}`))
        return
      }

      resolve({
        exitCode,
        stdout: stdout.toString(),
        stderr: stderr.toString() || error.message,
      })
      return
    }

    resolve({
      exitCode: 0,
      stdout: stdout.toString(),
      stderr: stderr.toString(),
    })
  })
})

export class ClaudeCliProvider implements Provider {
  readonly provider_id = 'claude'
  readonly capabilities = {
    'text-generation': 'native',
    'structured-output': 'native',
    'tool-function-calling': 'unsupported',
    'streaming-observability': 'adapter',
    'multi-step-tool-loop': 'unsupported',
  } as const

  private readonly env: NodeJS.ProcessEnv
  private readonly command: string
  private readonly runCommand: CommandRunner

  constructor(options: ClaudeCliProviderOptions = {}) {
    this.env = { ...process.env, ...options.env }
    this.command = options.command ?? 'claude'
    this.runCommand = options.runCommand ?? defaultRunner
  }

  async complete(request: ProviderRunRequest): Promise<ProviderCompletion> {
    const observations = this.observationsFor('running', 'Claude CLI started the request.')
    const result = await this.runOrThrow(
      request,
      ['--print', '--output-format', 'text', '--model', request.model_id, request.prompt],
      observations,
    )

    observations.push(this.observation('completed', 'Claude CLI completed the request.'))

    return {
      text: result.stdout.trim(),
      metadata: this.metadataFor(request),
      observations,
      finish_reason: 'completed',
    }
  }

  async structured<T>(request: ProviderRunRequest, schema: ZodType<T>): Promise<T> {
    const observations = this.observationsFor('running', 'Claude CLI started the structured request.')
    const jsonSchema = z.toJSONSchema(schema)
    const result = await this.runOrThrow(
      request,
      [
        '--print',
        '--output-format',
        'json',
        '--model',
        request.model_id,
        '--json-schema',
        JSON.stringify(jsonSchema),
        request.prompt,
      ],
      observations,
    )

    observations.push(this.observation('completed', 'Claude CLI completed the structured request.'))

    let parsed: unknown
    try {
      parsed = JSON.parse(result.stdout)
    } catch (error) {
      throw new Error(`Structured output validation failed: provider returned invalid JSON (${error instanceof Error ? error.message : 'unknown error'})`)
    }

    const validated = schema.safeParse(parsed)
    if (!validated.success) {
      throw new Error(`Structured output validation failed: ${validated.error.message}`)
    }

    return validated.data
  }

  async runWithTools(request: ProviderRunRequest): Promise<ProviderToolRun> {
    const completion = await this.complete(request)
    return {
      text: completion.text,
      metadata: completion.metadata,
      observations: completion.observations,
      tool_calls: [],
      finish_reason: 'completed',
      ledger_events_written: 0,
    }
  }

  private async runOrThrow(
    request: ProviderRunRequest,
    args: string[],
    observations: ProviderObservation[],
  ): Promise<CommandRunResult> {
    observations.push(this.observation('queued', 'Claude CLI queued the request.'))

    const result = await this.runCommand(this.command, args, this.env, request.timeout_ms)
    if (result.exitCode !== 0) {
      observations.push(this.observation('failed', `Claude CLI failed with exit code ${result.exitCode}.`))
      throw new Error(`Claude CLI failed with exit code ${result.exitCode}: ${result.stderr.trim() || 'unknown error'}`)
    }

    return result
  }

  private metadataFor(request: ProviderRunRequest): ProviderRunMetadata {
    return {
      provider_id: this.provider_id,
      run_id: request.run_id,
      model_id: request.model_id,
      timeout_ms: request.timeout_ms,
      tool_allowlist: [...request.tool_allowlist],
      task_kind: request.task_kind,
      response_format: request.response_format,
    }
  }

  private observationsFor(stage: 'running', message: string): ProviderObservation[] {
    return [
      this.observation('queued', 'Claude CLI queued the request.'),
      this.observation(stage, message),
    ]
  }

  private observation(stage: ProviderObservation['stage'], message: string): ProviderObservation {
    return {
      at: new Date().toISOString(),
      stage,
      message,
    }
  }
}
