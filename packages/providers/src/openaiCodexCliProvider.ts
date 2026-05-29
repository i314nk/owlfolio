import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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

export type OpenAICodexCliProviderOptions = {
  env?: NodeJS.ProcessEnv
  command?: string
  runCommand?: CommandRunner
}

type CodexJsonEvent = {
  type?: string
  message?: string
  error?: {
    message?: string
  }
}

const defaultRunner: CommandRunner = (command, args, env, timeoutMs) => new Promise((resolve, reject) => {
  execFile(command, args, { env, timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
    if (error !== null) {
      const exitCode = typeof error.code === 'number' ? error.code : -1
      if ('code' in error && error.code === 'ENOENT') {
        reject(new Error(`Codex CLI not available: ${command}`))
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

export class OpenAICodexCliProvider implements Provider {
  readonly provider_id = 'openai'
  readonly capabilities = {
    'text-generation': 'native',
    'structured-output': 'adapter',
    'tool-function-calling': 'unsupported',
    'streaming-observability': 'adapter',
    'multi-step-tool-loop': 'unsupported',
  } as const

  private readonly env: NodeJS.ProcessEnv
  private readonly command: string
  private readonly runCommand: CommandRunner

  constructor(options: OpenAICodexCliProviderOptions = {}) {
    this.env = { ...process.env, ...options.env }
    this.command = options.command ?? 'codex'
    this.runCommand = options.runCommand ?? defaultRunner
  }

  async complete(request: ProviderRunRequest): Promise<ProviderCompletion> {
    const observations = this.observationsFor('running', 'Codex CLI started the request.')
    const result = await this.withTempOutput(async (dir, outputPath) => {
      const runResult = await this.runOrThrow(
        request,
        [
          'exec',
          '--skip-git-repo-check',
          '--sandbox',
          'read-only',
          '--model',
          request.model_id,
          '--json',
          '-o',
          outputPath,
          request.prompt,
        ],
        observations,
      )
      const text = await this.readOutputOrThrow(outputPath)
      return { runResult, text, dir }
    })

    observations.push(...this.observationsFromStdout(result.runResult.stdout))
    observations.push(this.observation('completed', 'Codex CLI completed the request.'))

    return {
      text: result.text.trim(),
      metadata: this.metadataFor(request),
      observations,
      finish_reason: 'completed',
    }
  }

  async structured<T>(request: ProviderRunRequest, schema: ZodType<T>): Promise<T> {
    const observations = this.observationsFor('running', 'Codex CLI started the structured request.')
    const output = await this.withTempOutput(async (dir, outputPath) => {
      const schemaPath = join(dir, 'schema.json')
      await writeFile(schemaPath, JSON.stringify(z.toJSONSchema(schema)), 'utf8')
      const runResult = await this.runOrThrow(
        request,
        [
          'exec',
          '--skip-git-repo-check',
          '--sandbox',
          'read-only',
          '--model',
          request.model_id,
          '--json',
          '--output-schema',
          schemaPath,
          '-o',
          outputPath,
          request.prompt,
        ],
        observations,
      )
      const text = await this.readOutputOrThrow(outputPath)
      return { runResult, text }
    })

    observations.push(...this.observationsFromStdout(output.runResult.stdout))
    observations.push(this.observation('completed', 'Codex CLI completed the structured request.'))

    let parsed: unknown
    try {
      parsed = JSON.parse(output.text)
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

  private async withTempOutput<T>(action: (dir: string, outputPath: string) => Promise<T>): Promise<T> {
    const dir = await mkdtemp(join(tmpdir(), 'owlfolio-codex-provider-'))
    const outputPath = join(dir, 'output.txt')
    try {
      return await action(dir, outputPath)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }

  private async readOutputOrThrow(outputPath: string): Promise<string> {
    try {
      return await readFile(outputPath, 'utf8')
    } catch {
      throw new Error(`Codex CLI completed without writing the expected output file: ${outputPath}`)
    }
  }

  private async runOrThrow(
    request: ProviderRunRequest,
    args: string[],
    observations: ProviderObservation[],
  ): Promise<CommandRunResult> {
    observations.push(this.observation('queued', 'Codex CLI queued the request.'))

    const result = await this.runCommand(this.command, args, this.env, request.timeout_ms)
    if (result.exitCode !== 0) {
      const message = this.failureMessageFrom(result)
      observations.push(this.observation('failed', `Codex CLI failed with exit code ${result.exitCode}.`))
      throw new Error(`Codex CLI failed with exit code ${result.exitCode}: ${message}`)
    }

    return result
  }

  private failureMessageFrom(result: CommandRunResult): string {
    const events = this.parseJsonEvents(result.stdout)
    const eventMessage = [...events].reverse().find((event) =>
      typeof event.error?.message === 'string' || typeof event.message === 'string',
    )

    return eventMessage?.error?.message?.trim()
      || eventMessage?.message?.trim()
      || result.stderr.trim()
      || 'unknown error'
  }

  private observationsFromStdout(stdout: string): ProviderObservation[] {
    return this.parseJsonEvents(stdout)
      .filter((event) => typeof event.message === 'string' && event.message.trim().length > 0)
      .map((event) => this.observation(this.stageFromEvent(event.type), event.message!.trim()))
  }

  private parseJsonEvents(stdout: string): CodexJsonEvent[] {
    return stdout
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith('{') && line.endsWith('}'))
      .flatMap((line) => {
        try {
          return [JSON.parse(line) as CodexJsonEvent]
        } catch {
          return []
        }
      })
  }

  private stageFromEvent(type: string | undefined): ProviderObservation['stage'] {
    switch (type) {
      case 'turn.completed':
        return 'completed'
      case 'turn.failed':
      case 'error':
        return 'failed'
      default:
        return 'running'
    }
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
      this.observation('queued', 'Codex CLI queued the request.'),
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
