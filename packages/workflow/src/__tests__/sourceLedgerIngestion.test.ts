import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { ingestManualSourceBundle } from '../sourceLedger'

const dirs: string[] = []

async function makeTempDir(prefix: string) {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  dirs.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })))
  dirs.length = 0
})

describe('manual source-bundle ingestion', () => {
  it('ingests an allowlisted local file with checksum provenance and redacted privacy fields', async () => {
    const projectDir = await makeTempDir('owlfolio-source-ingest-')
    const evidenceRoot = join(projectDir, 'manual-evidence')
    const secretFileName = 'costco-filing-sk_live_path_secret.txt'
    const evidencePath = join(evidenceRoot, secretFileName)
    const evidenceText = 'Costco annual filing says membership renewal remained above 90%.'
    await mkdir(evidenceRoot, { recursive: true })
    await writeFile(evidencePath, evidenceText, 'utf8')

    const bundle = await ingestManualSourceBundle({
      source_ledger_path: join(projectDir, 'source-ledger'),
      research_case_id: 'rc_cost_001',
      ticker: 'COST',
      strategy_id: 'buffett-munger',
      provider_id: 'manual-local',
      ingested_by_actor_type: 'user',
      ingested_by_actor_id: 'user_local',
      allowlisted_file_roots: [evidenceRoot],
      captured_at: '2026-06-03T00:00:00.000Z',
      sources: [
        {
          source_id: 'src_cost_annual_report_manual',
          kind: 'local-file',
          path: evidencePath,
          title: 'Costco annual report manual source',
          metadata: {
            user_note: 'Imported from local filing archive.',
            private_path: evidencePath,
            access_token: 'sk_live_should_not_escape',
            ticker: 'MSFT',
            privacy: { local_path_redacted: false },
          },
        },
      ],
    })

    const expectedHash = `sha256:${createHash('sha256').update(evidenceText).digest('hex')}`
    expect(bundle.records).toHaveLength(1)
    expect(bundle.records[0]).toMatchObject({
      source_record_id: 'source_record_rc_cost_001_1',
      research_case_id: 'rc_cost_001',
      source_id: 'src_cost_annual_report_manual',
      provider_id: 'manual-local',
      source_type: 'local-file',
      availability: 'available',
      content_hash: expectedHash,
      ingested_by_actor_type: 'user',
      ingested_by_actor_id: 'user_local',
      proposed_by_actor_type: 'user',
      proposed_by_actor_id: 'user_local',
      metadata: {
        ticker: 'COST',
        strategy_id: 'buffett-munger',
        privacy: {
          local_path_redacted: true,
          local_file_name_redacted: true,
        },
        user_note: 'Imported from local filing archive.',
      },
    })

    const bundleText = await readFile(bundle.bundle_path, 'utf8')
    expect(bundleText).not.toContain(projectDir)
    expect(bundleText).not.toContain(secretFileName)
    expect(bundleText).not.toContain('sk_live_should_not_escape')
    expect(bundleText).not.toContain(basename(evidencePath))
  })

  it('keeps ticker/source provenance isolated across bundles even when source ids overlap', async () => {
    const projectDir = await makeTempDir('owlfolio-source-isolation-')
    const sourceLedgerPath = join(projectDir, 'source-ledger')

    const costBundle = await ingestManualSourceBundle({
      source_ledger_path: sourceLedgerPath,
      research_case_id: 'rc_cost_001',
      ticker: 'COST',
      strategy_id: 'buffett-munger',
      ingested_by_actor_type: 'system',
      ingested_by_actor_id: 'source_ingestion_job',
      captured_at: '2026-06-03T00:00:00.000Z',
      sources: [{ source_id: 'src_latest_10k', kind: 'url', url: 'https://investor.costco.example/10k', title: 'Costco 10-K' }],
    })
    const msftBundle = await ingestManualSourceBundle({
      source_ledger_path: sourceLedgerPath,
      research_case_id: 'rc_msft_001',
      ticker: 'MSFT',
      strategy_id: 'buffett-munger',
      ingested_by_actor_type: 'system',
      ingested_by_actor_id: 'source_ingestion_job',
      captured_at: '2026-06-03T00:00:00.000Z',
      sources: [{ source_id: 'src_latest_10k', kind: 'url', url: 'https://investor.microsoft.example/10k', title: 'Microsoft 10-K' }],
    })

    expect(costBundle.bundle_path).not.toBe(msftBundle.bundle_path)
    expect(costBundle.records[0]?.source_record_id).toBe('source_record_rc_cost_001_1')
    expect(msftBundle.records[0]?.source_record_id).toBe('source_record_rc_msft_001_1')
    expect(costBundle.records[0]?.metadata).toMatchObject({ ticker: 'COST' })
    expect(msftBundle.records[0]?.metadata).toMatchObject({ ticker: 'MSFT' })
  })

  it('records missing local evidence as unavailable without leaking the requested path', async () => {
    const projectDir = await makeTempDir('owlfolio-source-missing-')
    const evidenceRoot = join(projectDir, 'manual-evidence')
    const missingPath = join(evidenceRoot, 'private-tokenized-filing.txt')

    const bundle = await ingestManualSourceBundle({
      source_ledger_path: join(projectDir, 'source-ledger'),
      research_case_id: 'rc_cost_missing',
      ticker: 'COST',
      strategy_id: 'buffett-munger',
      ingested_by_actor_type: 'user',
      ingested_by_actor_id: 'user_local',
      allowlisted_file_roots: [evidenceRoot],
      captured_at: '2026-06-03T00:00:00.000Z',
      sources: [{ source_id: 'src_missing_local_file', kind: 'local-file', path: missingPath }],
    })

    expect(bundle.records[0]).toMatchObject({
      availability: 'unavailable',
      source_type: 'local-file',
      metadata: {
        unavailable_reason: 'local_file_not_found',
        privacy: {
          local_path_redacted: true,
          local_file_name_redacted: true,
        },
      },
    })
    expect(bundle.records[0]?.content_hash).toBeUndefined()

    const bundleText = await readFile(bundle.bundle_path, 'utf8')
    expect(bundleText).not.toContain(missingPath)
    expect(bundleText).not.toContain('private-tokenized-filing.txt')
  })

  it('accepts provider-proposed URL sources but rejects provider-authored ingestion writes', async () => {
    const projectDir = await makeTempDir('owlfolio-source-provider-boundary-')

    const bundle = await ingestManualSourceBundle({
      source_ledger_path: join(projectDir, 'source-ledger'),
      research_case_id: 'rc_msft_provider_proposal',
      ticker: 'MSFT',
      strategy_id: 'buffett-munger',
      provider_id: 'openai-codex-cli',
      proposed_by_actor_type: 'provider',
      proposed_by_actor_id: 'openai-codex-cli',
      ingested_by_actor_type: 'system',
      ingested_by_actor_id: 'source_ingestion_job',
      sources: [
        {
          source_id: 'src_msft_provider_url',
          kind: 'url',
          url: 'https://www.microsoft.com/investor/reports/ar25',
          title: 'Microsoft annual report',
          content_hash: 'sha256:provided-by-provider',
          availability: 'available',
        },
      ],
    })

    expect(bundle.records[0]).toMatchObject({
      provider_id: 'openai-codex-cli',
      source_type: 'url',
      url: 'https://www.microsoft.com/investor/reports/ar25',
      proposed_by_actor_type: 'provider',
      proposed_by_actor_id: 'openai-codex-cli',
      ingested_by_actor_type: 'system',
      ingested_by_actor_id: 'source_ingestion_job',
    })

    await expect(ingestManualSourceBundle({
      source_ledger_path: join(projectDir, 'source-ledger'),
      research_case_id: 'rc_bad_provider_write',
      ticker: 'MSFT',
      strategy_id: 'buffett-munger',
      ingested_by_actor_type: 'provider',
      ingested_by_actor_id: 'openai-codex-cli',
      sources: [{ source_id: 'src_bad_provider_write', kind: 'url', url: 'https://example.test/source' }],
    })).rejects.toThrow('Source bundle ingestion must be performed by a user or system actor')
  })

  it('rejects unsafe bundle ids before constructing the bundle path', async () => {
    const projectDir = await makeTempDir('owlfolio-source-safe-id-')

    await expect(ingestManualSourceBundle({
      source_ledger_path: join(projectDir, 'source-ledger'),
      research_case_id: '../escape',
      ticker: 'MSFT',
      strategy_id: 'buffett-munger',
      ingested_by_actor_type: 'system',
      ingested_by_actor_id: 'source_ingestion_job',
      sources: [{ source_id: 'src_safe', kind: 'url', url: 'https://example.test/source' }],
    })).rejects.toThrow('Research case id must be a safe source-ledger slug')
  })

  it('redacts URL credentials and query secrets before writing bundle JSON', async () => {
    const projectDir = await makeTempDir('owlfolio-source-url-redaction-')

    const bundle = await ingestManualSourceBundle({
      source_ledger_path: join(projectDir, 'source-ledger'),
      research_case_id: 'rc_url_secret',
      ticker: 'MSFT',
      strategy_id: 'buffett-munger',
      ingested_by_actor_type: 'system',
      ingested_by_actor_id: 'source_ingestion_job',
      sources: [{
        source_id: 'src_url_secret',
        kind: 'url',
        url: 'https://user:pass@example.test/filing?token=sk_live_should_not_escape&download=1#private-fragment',
      }],
    })

    expect(bundle.records[0]?.url).toBe('https://example.test/filing')
    const bundleText = await readFile(bundle.bundle_path, 'utf8')
    expect(bundleText).not.toContain('user:pass')
    expect(bundleText).not.toContain('sk_live_should_not_escape')
    expect(bundleText).not.toContain('private-fragment')
  })

  it('redacts nested metadata arrays and rejects sensitive source identifiers', async () => {
    const projectDir = await makeTempDir('owlfolio-source-metadata-redaction-')

    const bundle = await ingestManualSourceBundle({
      source_ledger_path: join(projectDir, 'source-ledger'),
      research_case_id: 'rc_metadata_redaction',
      ticker: 'MSFT',
      strategy_id: 'buffett-munger',
      ingested_by_actor_type: 'system',
      ingested_by_actor_id: 'source_ingestion_job',
      sources: [{
        source_id: 'src_metadata_safe',
        kind: 'url',
        url: 'https://example.test/source',
        metadata: { files: ['/home/user/private-token.txt'], labels: ['safe label'] },
      }],
    })

    expect(bundle.records[0]?.metadata).toMatchObject({ labels: ['safe label'] })
    const bundleText = await readFile(bundle.bundle_path, 'utf8')
    expect(bundleText).not.toContain('/home/user/private-token.txt')

    await expect(ingestManualSourceBundle({
      source_ledger_path: join(projectDir, 'source-ledger'),
      research_case_id: 'rc_bad_source_id',
      ticker: 'MSFT',
      strategy_id: 'buffett-munger',
      ingested_by_actor_type: 'system',
      ingested_by_actor_id: 'source_ingestion_job',
      sources: [{ source_id: '/home/user/sk_live_source.txt', kind: 'url', url: 'https://example.test/source' }],
    })).rejects.toThrow('Source id must be a safe source-ledger slug')
  })

  it('rejects allowlisted local symlinks that resolve outside the evidence root', async () => {
    const projectDir = await makeTempDir('owlfolio-source-symlink-')
    const evidenceRoot = join(projectDir, 'manual-evidence')
    const outsideRoot = join(projectDir, 'outside')
    await mkdir(evidenceRoot, { recursive: true })
    await mkdir(outsideRoot, { recursive: true })
    const outsideFile = join(outsideRoot, 'external-filing.txt')
    const symlinkPath = join(evidenceRoot, 'external-filing-link.txt')
    await writeFile(outsideFile, 'External evidence should not be allowlisted through a symlink.', 'utf8')
    await symlink(outsideFile, symlinkPath)

    await expect(ingestManualSourceBundle({
      source_ledger_path: join(projectDir, 'source-ledger'),
      research_case_id: 'rc_symlink_rejected',
      ticker: 'MSFT',
      strategy_id: 'buffett-munger',
      ingested_by_actor_type: 'user',
      ingested_by_actor_id: 'user_local',
      allowlisted_file_roots: [evidenceRoot],
      sources: [{ source_id: 'src_symlink', kind: 'local-file', path: symlinkPath }],
    })).rejects.toThrow('Local source file is outside allowlisted evidence roots')
  })

  it('marks provider-supplied URL hashes and availability as claimed rather than verified', async () => {
    const projectDir = await makeTempDir('owlfolio-source-provider-claims-')

    const bundle = await ingestManualSourceBundle({
      source_ledger_path: join(projectDir, 'source-ledger'),
      research_case_id: 'rc_provider_claims',
      ticker: 'MSFT',
      strategy_id: 'buffett-munger',
      provider_id: 'openai-codex-cli',
      proposed_by_actor_type: 'provider',
      proposed_by_actor_id: 'openai-codex-cli',
      ingested_by_actor_type: 'system',
      ingested_by_actor_id: 'source_ingestion_job',
      sources: [{
        source_id: 'src_provider_claimed_hash',
        kind: 'url',
        url: 'https://example.test/filing',
        content_hash: 'sha256:provider-claimed',
        availability: 'available',
      }],
    })

    expect(bundle.records[0]?.metadata).toMatchObject({
      content_hash_verification: 'provider_claimed',
      availability_verification: 'provider_claimed',
    })
  })

  it('persists source_category / filing_form / filed / fetched_at as TOP-LEVEL record fields (Axis B)', async () => {
    const projectDir = await makeTempDir('owlfolio-source-enrichment-')

    const bundle = await ingestManualSourceBundle({
      source_ledger_path: join(projectDir, 'source-ledger'),
      research_case_id: 'rc_enrichment',
      ticker: 'COST',
      strategy_id: 'buffett-munger',
      ingested_by_actor_type: 'system',
      ingested_by_actor_id: 'research_workflow',
      sources: [{
        source_id: 'sec_edgar_def14a_0000909832_2025-12-04',
        kind: 'url',
        url: 'https://www.sec.gov/Archives/edgar/data/909832/000090983225000200/cost-20251204.htm',
        content_hash: 'sha256:abc',
        availability: 'available',
        source_category: 'proxy',
        filing_form: 'DEF 14A',
        filed: '2025-12-04',
        fetched_at: '2026-07-04T00:00:00.000Z',
      }],
    })

    expect(bundle.records[0]).toMatchObject({
      source_category: 'proxy',
      filing_form: 'DEF 14A',
      filed: '2025-12-04',
      fetched_at: '2026-07-04T00:00:00.000Z',
    })
  })

  it('DOCUMENTATION: a metadata value containing "/" (e.g. the form "8-K/A") is silently dropped by the sanitizer — the reason the enrichment fields are top-level, not metadata', async () => {
    const projectDir = await makeTempDir('owlfolio-source-slash-redaction-')

    const bundle = await ingestManualSourceBundle({
      source_ledger_path: join(projectDir, 'source-ledger'),
      research_case_id: 'rc_slash_redaction',
      ticker: 'COST',
      strategy_id: 'buffett-munger',
      ingested_by_actor_type: 'system',
      ingested_by_actor_id: 'research_workflow',
      sources: [{
        source_id: 'src_slash',
        kind: 'url',
        url: 'https://example.test/filing',
        metadata: { form_in_metadata: '8-K/A', safe_note: 'kept' },
      }],
    })

    const metadata = bundle.records[0]?.metadata ?? {}
    expect(metadata).not.toHaveProperty('form_in_metadata')
    expect(metadata).toMatchObject({ safe_note: 'kept' })
  })
})
