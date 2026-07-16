// `owlfolio start` — launch the web app (the primary product surface) and open the browser to it.
// Onboarding lives in the browser, so this is the single entrypoint: start the dev server, open the tab.
import { spawn as nodeSpawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { CliContext } from './context'

const APP_URL = 'http://127.0.0.1:3000'

// A minimal child handle so the real ChildProcess and a test fake share one shape.
export type StartChild = { on: (event: 'exit' | 'error', listener: (arg: never) => void) => void }

export type StartDeps = {
  /** Spawn the app dev server (defaults to `corepack pnpm dev` at the repo root, inheriting stdio). */
  spawn?: (command: string, args: readonly string[], cwd: string) => StartChild
  /** Best-effort browser open once the server is reachable (defaults to the platform opener). */
  openBrowser?: (url: string, ctx: CliContext) => void
  /** Repo root override (defaults to three levels up from this module). */
  repoRoot?: string
}

/** apps/cli/src/start.ts → repo root is three directories up. Robust to the launcher's invocation cwd. */
function defaultRepoRoot(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
}

function realSpawn(command: string, args: readonly string[], cwd: string): StartChild {
  return nodeSpawn(command, [...args], { cwd, stdio: 'inherit' }) as unknown as StartChild
}

async function waitForServer(url: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url)
      if (response.status < 500) {
        return true
      }
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  return false
}

function realOpenBrowser(url: string, ctx: CliContext): void {
  void (async () => {
    const ready = await waitForServer(url, 30_000)
    if (!ready) {
      return
    }
    ctx.out(`→ opening browser at ${url}`)
    const [opener, openerArgs] = process.platform === 'darwin'
      ? ['open', [url]]
      : process.platform === 'win32'
        ? ['cmd', ['/c', 'start', '', url]]
        : ['xdg-open', [url]]
    try {
      nodeSpawn(opener as string, openerArgs as string[], { stdio: 'ignore', detached: true }).unref()
    } catch {
      // best-effort — the URL is already printed, the user can open it manually
    }
  })()
}

export async function runStart(ctx: CliContext, deps: StartDeps = {}): Promise<number> {
  const root = deps.repoRoot ?? defaultRepoRoot()
  const spawnImpl = deps.spawn ?? realSpawn
  const openBrowser = deps.openBrowser ?? realOpenBrowser

  ctx.out(`→ starting Owner’s Manual on ${APP_URL}`)
  ctx.out('  (press Ctrl-C to stop; onboarding and setup happen in the browser)')

  // Fire-and-forget: open the browser once the server answers.
  openBrowser(APP_URL, ctx)

  const child = spawnImpl('corepack', ['pnpm', 'dev'], root)
  return await new Promise<number>((resolve) => {
    child.on('exit', ((code: number | null) => resolve(typeof code === 'number' ? code : 0)) as (arg: never) => void)
    child.on('error', ((error: Error) => {
      ctx.out(`Failed to start the app: ${error instanceof Error ? error.message : String(error)}`)
      resolve(1)
    }) as (arg: never) => void)
  })
}
