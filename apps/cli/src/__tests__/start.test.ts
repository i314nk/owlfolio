import { describe, expect, it } from 'vitest'

import { runStart, type StartChild } from '../start'
import type { CliContext } from '../context'

function ctx(lines: string[]): CliContext {
  return { out: (line) => lines.push(line), cwd: '/tmp', env: {} as NodeJS.ProcessEnv }
}

describe('owlfolio start', () => {
  it('launches `corepack pnpm dev` at the repo root and reports the URL', async () => {
    const lines: string[] = []
    let spawned: { command: string; args: readonly string[]; cwd: string } | undefined
    let browserOpened = false

    const child: StartChild = {
      on: (event, listener) => {
        // Resolve immediately with exit code 0 so the promise settles in the test.
        if (event === 'exit') {
          (listener as (arg: number) => void)(0)
        }
      },
    }

    const code = await runStart(ctx(lines), {
      spawn: (command, args, cwd) => {
        spawned = { command, args, cwd }
        return child
      },
      openBrowser: () => {
        browserOpened = true
      },
      repoRoot: '/repo',
    })

    expect(code).toBe(0)
    expect(spawned).toEqual({ command: 'corepack', args: ['pnpm', 'dev'], cwd: '/repo' })
    expect(browserOpened).toBe(true)
    const text = lines.join('\n')
    expect(text).toContain('http://127.0.0.1:3000')
    expect(text.toLowerCase()).toContain('browser')
  })

  it('returns non-zero and reports when the app fails to start', async () => {
    const lines: string[] = []
    const child: StartChild = {
      on: (event, listener) => {
        if (event === 'error') {
          (listener as (arg: Error) => void)(new Error('corepack not found'))
        }
      },
    }
    const code = await runStart(ctx(lines), {
      spawn: () => child,
      openBrowser: () => {},
      repoRoot: '/repo',
    })
    expect(code).toBe(1)
    expect(lines.join('\n')).toContain('Failed to start the app: corepack not found')
  })
})
