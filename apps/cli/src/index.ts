#!/usr/bin/env node
// owlfolio CLI — a small, hermes-style entrypoint for the local-first workflow. The web app is the primary
// product surface (all onboarding lives in the browser), so the CLI is deliberately tiny: inspect state
// (`status`), diagnose problems (`doctor`), and launch the app (`start`). `main` is exported and accepts
// injectable overrides so commands are unit-testable.
import { pathToFileURL } from 'node:url'

import { runStatus } from './status'
import { runDoctor } from './doctor'
import { runStart } from './start'
import type { CliContext } from './context'

export type MainOverrides = {
  out?: (line: string) => void
  cwd?: string
  env?: NodeJS.ProcessEnv
}

export function usage(): string {
  return [
    'Owlfolio — local-first investment workflow',
    '',
    'Usage:',
    '  owlfolio <command>',
    '',
    'Commands:',
    '  start             Launch the app and open the browser (onboarding lives in the app).',
    '  status            Show mode, provider/model, readiness, and the setup gate.',
    '  doctor            Diagnose config, credentials, ledger, and certification state.',
    '  help              Show this help.',
    '',
    'Environment overrides:',
    '  OWLFOLIO_PROJECT_DIR, OWLFOLIO_APP_CONFIG_PATH, OWLFOLIO_ENV_FILE,',
    '  OWLFOLIO_PERSONAL_LEDGER_PATH',
  ].join('\n')
}

export async function main(argv: string[] = process.argv.slice(2), overrides: MainOverrides = {}): Promise<number> {
  const out = overrides.out ?? ((line: string) => console.log(line))
  const ctx: CliContext = {
    out,
    cwd: overrides.cwd ?? process.cwd(),
    env: overrides.env ?? process.env,
  }

  const command = argv[0]
  switch (command) {
    case undefined:
    case 'help':
    case '--help':
    case '-h':
      out(usage())
      return 0
    case 'start':
      return await runStart(ctx)
    case 'status':
      return await runStatus(ctx)
    case 'doctor':
      return await runDoctor(ctx)
    default:
      out(`Unknown command: ${command}`)
      out('')
      out(usage())
      return 1
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(
    (exitCode) => {
      process.exitCode = exitCode
    },
    (error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error))
      process.exitCode = 1
    },
  )
}
