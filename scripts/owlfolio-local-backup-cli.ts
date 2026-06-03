import { execFile } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { promisify } from 'node:util'

import {
  buildRestoreDryRunPlan,
  buildRuntimeBackupManifest,
  resolveRuntimeBackupInventory,
  type RuntimeBackupManifest,
} from './owlfolio-local-backup'

const execFileAsync = promisify(execFile)

type ParsedArgs = {
  command: string | undefined
  output: string | undefined
  manifest: string | undefined
  restoreRoot: string | undefined
  pretty: boolean
}

function usage(): string {
  return [
    'Usage:',
    '  corepack pnpm ops:backup:manifest -- [--output manifest.json]',
    '  corepack pnpm ops:restore:dry-run -- --manifest manifest.json --restore-root /tmp/owlfolio-restore',
    '  corepack pnpm ops:restore:verify -- --manifest manifest.json --restore-root /tmp/owlfolio-restore',
    '',
    'Commands:',
    '  inventory          Print resolved allowlisted runtime inventory and excluded paths.',
    '  manifest           Print/write a checksum manifest for existing allowlisted runtime files.',
    '  restore-dry-run    Print isolated restore path rewrites and verification environment.',
    '  verify-restore     Print restore verification commands; does not run credentials or mutate state.',
    '',
    'Safety: manifests include local investment/source/certification paths and checksums, but never copy .env, auth homes, logs, PIDs, or generated test/build dirs.',
  ].join('\n')
}

function parseArgs(argv: string[]): ParsedArgs {
  const args: ParsedArgs = { command: argv[0], output: undefined, manifest: undefined, restoreRoot: undefined, pretty: true }

  for (let index = 1; index < argv.length; index += 1) {
    const token = argv[index]
    if (token === '--') {
      continue
    }

    if (token === '--output') {
      args.output = argv[index + 1]
      index += 1
    } else if (token === '--manifest') {
      args.manifest = argv[index + 1]
      index += 1
    } else if (token === '--restore-root') {
      args.restoreRoot = argv[index + 1]
      index += 1
    } else if (token === '--compact') {
      args.pretty = false
    } else if (token === '--help' || token === '-h') {
      args.command = 'help'
    } else {
      throw new Error(`Unknown argument: ${token}`)
    }
  }

  return args
}

async function gitCommit(): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', '--short', 'HEAD'])
    return stdout.trim() || 'unknown'
  } catch {
    return 'unknown'
  }
}

function stringify(value: unknown, pretty: boolean): string {
  return JSON.stringify(value, null, pretty ? 2 : 0)
}

async function readManifest(pathValue: string | undefined): Promise<RuntimeBackupManifest> {
  if (pathValue === undefined || pathValue.length === 0) {
    throw new Error('--manifest is required')
  }

  return JSON.parse(await readFile(pathValue, 'utf8')) as RuntimeBackupManifest
}

async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  const args = parseArgs(argv)

  if (args.command === undefined || args.command === 'help') {
    console.log(usage())
    return args.command === 'help' ? 0 : 1
  }

  if (args.command === 'inventory') {
    console.log(stringify(await resolveRuntimeBackupInventory(), args.pretty))
    return 0
  }

  if (args.command === 'manifest') {
    const manifest = await buildRuntimeBackupManifest({ gitCommit })
    const body = `${stringify(manifest, args.pretty)}\n`
    if (args.output !== undefined) {
      await writeFile(args.output, body, 'utf8')
      console.log(`Wrote Owlfolio runtime backup manifest: ${args.output}`)
    } else {
      console.log(body.trimEnd())
    }
    return 0
  }

  if (args.command === 'restore-dry-run') {
    if (args.restoreRoot === undefined || args.restoreRoot.length === 0) {
      throw new Error('--restore-root is required')
    }

    const manifest = await readManifest(args.manifest)
    console.log(stringify(buildRestoreDryRunPlan({ manifest, restoreRoot: args.restoreRoot }), args.pretty))
    return 0
  }

  if (args.command === 'verify-restore') {
    if (args.restoreRoot === undefined || args.restoreRoot.length === 0) {
      throw new Error('--restore-root is required')
    }

    const manifest = await readManifest(args.manifest)
    const plan = buildRestoreDryRunPlan({ manifest, restoreRoot: args.restoreRoot })
    console.log(stringify({ verification_env: plan.verification_env, verification_commands: plan.verification_commands }, args.pretty))
    return 0
  }

  throw new Error(`Unknown command: ${args.command}`)
}

main().then((code) => {
  process.exitCode = code
}).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  console.error(usage())
  process.exitCode = 1
})
