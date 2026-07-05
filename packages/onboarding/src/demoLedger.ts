// Demo-ledger plumbing — split out of apps/web/src/lib/demo.ts so the framework-agnostic
// pieces (path resolution + the default demo SQLite store singleton) live in the shared
// package. The web `demo.ts` keeps the command-center VIEW builders (which depend on
// `../components/StatusBadge`, accounting, modeView) and re-exports these for back-compat.
//
// Demo mode is a TEST-ONLY harness (gated by shouldUseTestDemoDefault); real users never
// trigger seeding. onboarding.ts uses resetDefaultDemoStore + resolveDemoLedgerPath here.
import { existsSync } from 'node:fs'
import { dirname, join, parse } from 'node:path'

import type { LedgerEventEnvelope } from '@owlfolio/ledger/eventEnvelope'
import type { EventStore } from '@owlfolio/ledger/eventStore'
import { SQLiteEventStore } from '@owlfolio/ledger/sqliteEventStore'

import { seedDemoLedger } from './demoSeed'

let defaultDemoStore: SQLiteEventStore | undefined

type DemoLedgerEnv = {
  OWLFOLIO_DEMO_LEDGER_PATH?: string
  OWLFOLIO_PROJECT_DIR?: string
}

type ResolveDemoLedgerPathOptions = {
  cwd?: string
  env?: DemoLedgerEnv
}

export function resolveDemoLedgerPath({ cwd = process.cwd(), env = process.env as DemoLedgerEnv }: ResolveDemoLedgerPathOptions = {}): string {
  if (env.OWLFOLIO_DEMO_LEDGER_PATH !== undefined && env.OWLFOLIO_DEMO_LEDGER_PATH.length > 0) {
    return env.OWLFOLIO_DEMO_LEDGER_PATH
  }

  const projectRoot = env.OWLFOLIO_PROJECT_DIR ?? findWorkspaceRoot(cwd) ?? cwd
  return join(projectRoot, 'data', 'demo-ledger.sqlite')
}

function findWorkspaceRoot(start: string): string | undefined {
  let current = start
  const { root } = parse(start)

  while (true) {
    if (existsSync(join(current, 'pnpm-workspace.yaml'))) {
      return current
    }

    if (current === root) {
      return undefined
    }

    current = dirname(current)
  }
}

export async function resetDefaultDemoStore(): Promise<void> {
  defaultDemoStore?.close()
  defaultDemoStore = undefined
}

export async function getDefaultDemoStore(): Promise<EventStore> {
  defaultDemoStore ??= new SQLiteEventStore(resolveDemoLedgerPath())
  await seedDemoLedger(defaultDemoStore)
  return defaultDemoStore
}

export async function getDemoEvents(): Promise<LedgerEventEnvelope<unknown>[]> {
  const store = await getDefaultDemoStore()
  return store.list()
}
