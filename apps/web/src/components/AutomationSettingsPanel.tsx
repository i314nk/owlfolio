'use client'

import { createElement, type CSSProperties, useCallback, useState } from 'react'

import type {
  AutomationCadenceDiscovery,
  AutomationCadencePriceRefresh,
  AutomationCadencePurification,
  AutomationCadenceWatchlist,
  AutomationSettings,
} from '@owlfolio/shared'
// Import the runtime bounds from the appConfig subpath (NOT the '@owlfolio/shared' barrel, which
// re-exports runtimeBackup → node:fs and cannot be bundled into this client component).
import {
  CIRCLE_GATE_EVIDENCE_FLOOR_MAX,
  CIRCLE_GATE_EVIDENCE_FLOOR_MIN,
  CIRCLE_GATE_K_SAMPLES_MAX,
  CIRCLE_GATE_K_SAMPLES_MIN,
  RESEARCH_MAX_TOOL_CALLS_MAX,
  RESEARCH_MAX_TOOL_CALLS_MIN,
} from '@owlfolio/shared/appConfig'

export type AutomationSettingsPanelProps = {
  initialAutomation: AutomationSettings
}

type SaveState = 'idle' | 'saving' | 'saved' | 'error'

// --- Styles (matching owl design tokens) ---

const panelStyle: CSSProperties = {
  display: 'grid',
  gap: '1.1rem',
  margin: '0 auto',
  maxWidth: '1120px',
}

const sectionStyle: CSSProperties = {
  background: 'var(--owl-color-panel-elevated)',
  border: '1px solid var(--owl-color-border)',
  borderRadius: 'var(--owl-radius-panel)',
  boxShadow: 'var(--owl-shadow-panel)',
  padding: 'clamp(1.15rem, 2vw, 1.3rem)',
  display: 'grid',
  gap: '0.9rem',
}

const pausedSectionStyle: CSSProperties = {
  ...sectionStyle,
  opacity: 0.45,
  pointerEvents: 'none' as const,
}

const controlRowStyle: CSSProperties = {
  alignItems: 'start',
  background: 'var(--owl-color-panel)',
  border: '1px solid var(--owl-color-border)',
  borderRadius: 'var(--owl-radius-card)',
  display: 'grid',
  gap: '0.35rem',
  gridTemplateColumns: 'minmax(0, 1fr) auto',
  padding: '0.9rem 1rem',
}

const controlLabelStyle: CSSProperties = {
  color: 'var(--owl-color-text)',
  fontSize: 'var(--owl-text-base)',
  fontWeight: 650,
  letterSpacing: '-0.01em',
}

const controlHelperStyle: CSSProperties = {
  color: 'var(--owl-color-muted)',
  fontSize: 'var(--owl-text-sm)',
  lineHeight: 1.45,
  margin: 0,
}

const controlValueAreaStyle: CSSProperties = {
  alignItems: 'center',
  display: 'flex',
  gap: '0.5rem',
}

const selectStyle: CSSProperties = {
  appearance: 'none',
  background: 'rgba(5, 7, 5, 0.82)',
  border: '1px solid rgba(52, 211, 153, 0.28)',
  borderRadius: '0.6rem',
  color: 'var(--owl-color-text)',
  fontSize: 'var(--owl-text-base)',
  fontWeight: 650,
  padding: '0.48rem 0.75rem',
  cursor: 'pointer',
}

const numberInputStyle: CSSProperties = {
  background: 'rgba(5, 7, 5, 0.82)',
  border: '1px solid rgba(52, 211, 153, 0.28)',
  borderRadius: '0.6rem',
  color: 'var(--owl-color-text)',
  fontSize: 'var(--owl-text-base)',
  fontWeight: 650,
  padding: '0.48rem 0.6rem',
  width: '4.5rem',
  textAlign: 'center' as const,
}

const toggleTrackBaseStyle: CSSProperties = {
  background: 'rgba(148, 163, 184, 0.22)',
  border: '2px solid rgba(148, 163, 184, 0.3)',
  borderRadius: '999px',
  cursor: 'pointer',
  display: 'inline-flex',
  height: '1.5rem',
  position: 'relative',
  transition: 'background 180ms ease, border-color 180ms ease',
  width: '2.75rem',
  flexShrink: 0,
}

const toggleTrackOnStyle: CSSProperties = {
  ...toggleTrackBaseStyle,
  background: 'rgba(22, 163, 74, 0.55)',
  border: '2px solid rgba(52, 211, 153, 0.6)',
}

const toggleThumbBaseStyle: CSSProperties = {
  background: '#94a3b8',
  borderRadius: '999px',
  height: '1rem',
  left: '0.14rem',
  position: 'absolute',
  top: '0.15rem',
  transition: 'left 180ms ease, background 180ms ease',
  width: '1rem',
}

const toggleThumbOnStyle: CSSProperties = {
  ...toggleThumbBaseStyle,
  background: '#ffffff',
  left: '1.46rem',
}

const controlGridStyle: CSSProperties = {
  display: 'grid',
  gap: '0.55rem',
}

const masterToggleRowStyle: CSSProperties = {
  alignItems: 'center',
  background: 'linear-gradient(135deg, rgba(22, 163, 74, 0.12), rgba(52, 211, 153, 0.06))',
  border: '1px solid rgba(52, 211, 153, 0.25)',
  borderRadius: '1rem',
  display: 'grid',
  gap: '0.55rem',
  gridTemplateColumns: 'minmax(0, 1fr) auto',
  padding: '1rem',
}

const masterToggleOffRowStyle: CSSProperties = {
  ...masterToggleRowStyle,
  background: 'rgba(239, 68, 68, 0.07)',
  border: '1px solid rgba(239, 68, 68, 0.22)',
}

const pausedNoticeBannerStyle: CSSProperties = {
  background: 'rgba(239, 68, 68, 0.09)',
  border: '1px solid rgba(239, 68, 68, 0.22)',
  borderRadius: '0.7rem',
  color: 'var(--owl-color-risk-soft)',
  fontSize: 'var(--owl-text-base)',
  fontWeight: 650,
  lineHeight: 1.45,
  padding: '0.65rem 0.85rem',
}

const saveBarStyle: CSSProperties = {
  alignItems: 'center',
  display: 'flex',
  gap: '0.75rem',
  justifyContent: 'flex-end',
  marginTop: '0.25rem',
}

const saveButtonStyle: CSSProperties = {
  background: 'linear-gradient(135deg, var(--owl-color-accent), #0f766e)',
  border: '1px solid rgba(52, 211, 153, 0.46)',
  borderRadius: '999px',
  color: '#fff',
  cursor: 'pointer',
  fontSize: 'var(--owl-text-base)',
  fontWeight: 650,
  padding: '0.6rem 1.05rem',
}

const saveButtonDisabledStyle: CSSProperties = {
  ...saveButtonStyle,
  background: 'rgba(148, 163, 184, 0.14)',
  border: '1px solid rgba(148, 163, 184, 0.2)',
  color: 'rgba(255, 248, 234, 0.4)',
  cursor: 'default',
}

const savedFeedbackStyle: CSSProperties = {
  color: 'var(--owl-color-accent-bright)',
  fontFamily: 'var(--owl-font-mono)',
  fontSize: 'var(--owl-text-xs)',
  fontWeight: 600,
  letterSpacing: '0.05em',
}

const errorFeedbackStyle: CSSProperties = {
  color: 'var(--owl-color-risk-soft)',
  fontSize: 'var(--owl-text-sm)',
}

const workerNoteStyle: CSSProperties = {
  color: 'var(--owl-color-quiet)',
  fontFamily: 'var(--owl-font-mono)',
  fontSize: 'var(--owl-text-2xs)',
  letterSpacing: '0.04em',
  marginTop: '0.1rem',
}

// --- Helpers ---

function Toggle({ enabled, onChange }: { enabled: boolean; onChange: (v: boolean) => void }) {
  return createElement(
    'button',
    {
      type: 'button',
      role: 'switch',
      'aria-checked': enabled,
      onClick: () => onChange(!enabled),
      style: enabled ? toggleTrackOnStyle : toggleTrackBaseStyle,
      title: enabled ? 'Enabled — click to disable' : 'Disabled — click to enable',
    },
    createElement('span', { style: enabled ? toggleThumbOnStyle : toggleThumbBaseStyle }),
  )
}

function ControlSelect<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
}) {
  return createElement(
    'select',
    {
      'aria-label': label,
      value,
      style: selectStyle,
      onChange: (e: React.ChangeEvent<HTMLSelectElement>) => onChange(e.target.value as T),
    },
    ...options.map(({ value: v, label: l }) =>
      createElement('option', { key: v, value: v }, l),
    ),
  )
}

function ControlNumber({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  onChange: (v: number) => void
}) {
  return createElement('input', {
    type: 'number',
    'aria-label': label,
    value,
    min,
    max,
    step: 1,
    style: numberInputStyle,
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
      const parsed = Number.parseInt(e.target.value, 10)
      // Keep the prior value when the field is mid-edit/empty; the server clamps on save.
      onChange(Number.isFinite(parsed) ? parsed : value)
    },
  })
}

function ControlRow({
  label,
  helper,
  workerNote,
  children,
}: {
  label: string
  helper: string
  workerNote?: string
  children?: React.ReactNode
}) {
  return createElement(
    'div',
    { style: controlRowStyle },
    createElement(
      'div',
      null,
      createElement('span', { style: controlLabelStyle }, label),
      createElement('p', { style: controlHelperStyle }, helper),
      workerNote !== undefined ? createElement('p', { style: workerNoteStyle }, workerNote) : null,
    ),
    createElement('div', { style: controlValueAreaStyle }, children),
  )
}

// --- Main panel ---

export function AutomationSettingsPanel({ initialAutomation }: AutomationSettingsPanelProps) {
  const [settings, setSettings] = useState<AutomationSettings>(initialAutomation)
  const [pendingSettings, setPendingSettings] = useState<AutomationSettings>(initialAutomation)
  const [saveState, setSaveState] = useState<SaveState>('idle')

  const engineOn = pendingSettings.research_engine_enabled

  const update = useCallback(<K extends keyof AutomationSettings>(key: K, value: AutomationSettings[K]) => {
    setPendingSettings((prev) => ({ ...prev, [key]: value }))
    setSaveState('idle')
  }, [])

  const handleSave = useCallback(async () => {
    setSaveState('saving')
    try {
      const res = await fetch('/api/settings/automation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(pendingSettings),
      })
      if (!res.ok) {
        setSaveState('error')
        return
      }
      const data = (await res.json()) as { automation: AutomationSettings }
      setSettings(data.automation)
      setPendingSettings(data.automation)
      setSaveState('saved')
    } catch {
      setSaveState('error')
    }
  }, [pendingSettings])

  const isDirty = JSON.stringify(settings) !== JSON.stringify(pendingSettings)
  const isSaving = saveState === 'saving'

  return createElement(
    'main',
    { className: 'owl-workflow-page', style: panelStyle },

    // --- Master toggle ---
    createElement(
      'section',
      { style: engineOn ? masterToggleRowStyle : masterToggleOffRowStyle, 'aria-label': 'Research engine master switch' },
      createElement(
        'div',
        null,
        createElement('p', { className: 'owl-section-accent' }, 'Pipeline control'),
        createElement('h2', { className: 'owl-section-title', style: { margin: '0 0 0.4rem' } }, 'Research engine'),
        createElement(
          'p',
          { style: controlHelperStyle },
          engineOn
            ? 'Research pipeline active — Owner’s Manual can discover, screen, and deep-dive candidate stocks.'
            : 'Research engine off — Owner’s Manual only manages your existing holdings.',
        ),
      ),
      createElement(Toggle, {
        enabled: engineOn,
        onChange: (v) => update('research_engine_enabled', v),
      }),
    ),

    // Paused notice when engine is off
    engineOn
      ? null
      : createElement(
        'p',
        { style: pausedNoticeBannerStyle },
        'Research pipeline paused. The discovery, deep-dive, and monitoring controls below are preserved but inactive while the engine is off.',
      ),

    // --- Research section ---
    createElement(
      'section',
      { style: engineOn ? sectionStyle : pausedSectionStyle, 'aria-label': 'Research pipeline settings', 'aria-disabled': !engineOn },
      createElement('p', { className: 'owl-section-accent' }, 'Research'),
      createElement('h3', { className: 'owl-section-title', style: { margin: '0 0 0.4rem' } }, 'Pipeline behaviour'),
      createElement(
        'div',
        { style: controlGridStyle },

        createElement(
          ControlRow,
          {
            label: 'Deep-dive approval',
            helper: 'How to handle a name that passes the Shariah + circle gates before the expensive deep dive runs.',
          },
          createElement(ControlSelect<AutomationSettings['deep_dive_approval']>, {
            label: 'Deep-dive approval',
            value: pendingSettings.deep_dive_approval,
            options: [
              { value: 'review', label: 'Review before deep dive' },
              { value: 'automatic', label: 'Automatic — run the deep dive immediately' },
            ],
            onChange: (v) => update('deep_dive_approval', v),
          }),
        ),

        createElement(
          ControlRow,
          {
            label: 'Superinvestors (13F discovery)',
            helper: 'Harvest the tracked superinvestors\u2019 quarterly 13F filings for new candidate ideas.',
            workerNote: 'Cadence takes effect when the local worker runs.',
          },
          createElement(Toggle, {
            enabled: pendingSettings.discovery.enabled,
            onChange: (v) => update('discovery', { ...pendingSettings.discovery, enabled: v }),
          }),
          createElement(ControlSelect<AutomationCadenceDiscovery>, {
            label: 'Discovery cadence',
            value: pendingSettings.discovery.cadence,
            options: [
              { value: 'off', label: 'Off' },
              { value: 'weekly', label: 'Weekly' },
              { value: 'monthly', label: 'Monthly' },
            ],
            onChange: (v) => update('discovery', { ...pendingSettings.discovery, cadence: v }),
          }),
        ),

        createElement(
          ControlRow,
          {
            label: 'Auto-run analysis on promotion',
            helper: 'ON: promoting a superinvestor candidate immediately starts the research run — provider spend. The cheap gates still run first (Shariah screening when on, then the circle of competence), and the Deep-dive approval setting above decides whether the expensive deep dive continues or pauses once they pass. OFF (default): a promoted case waits for you to start the analysis.',
          },
          createElement(Toggle, {
            enabled: pendingSettings.discovery.auto_research,
            onChange: (v) => update('discovery', { ...pendingSettings.discovery, auto_research: v }),
          }),
        ),

        createElement(
          ControlRow,
          {
            label: 'Research depth (advanced)',
            helper: `Max grounded tool calls (SEC filing fetches / searches) each research lane may make while gathering evidence. Higher = deeper sourcing but more cost and time; lower = faster and cheaper but shallower. Range ${RESEARCH_MAX_TOOL_CALLS_MIN}–${RESEARCH_MAX_TOOL_CALLS_MAX}; default 10.`,
          },
          createElement(ControlNumber, {
            label: 'Research depth (max grounded tool calls per lane)',
            value: pendingSettings.research_max_tool_calls,
            min: RESEARCH_MAX_TOOL_CALLS_MIN,
            max: RESEARCH_MAX_TOOL_CALLS_MAX,
            onChange: (v) => update('research_max_tool_calls', v),
          }),
        ),

        createElement(
          ControlRow,
          {
            label: 'Circle-gate agreement samples (advanced)',
            helper: `How many independent circle-of-competence judgments a run samples; the deep dive is entered only when ALL agree the business is within competence. 1 = single judgment (fastest, can flip run-to-run); higher = steadier gate at one extra model call per sample. Range ${CIRCLE_GATE_K_SAMPLES_MIN}–${CIRCLE_GATE_K_SAMPLES_MAX}; default 2.`,
          },
          createElement(ControlNumber, {
            label: 'Circle-gate agreement samples',
            value: pendingSettings.circle_gate_k_samples,
            min: CIRCLE_GATE_K_SAMPLES_MIN,
            max: CIRCLE_GATE_K_SAMPLES_MAX,
            onChange: (v) => update('circle_gate_k_samples', v),
          }),
        ),

        createElement(
          ControlRow,
          {
            label: 'Circle-gate evidence floor: cashflow drivers (advanced)',
            helper: `Minimum cite-verified cashflow drivers each circle-gate judgment must ground; a thinner gather counts as outside the circle (fail-closed). Range ${CIRCLE_GATE_EVIDENCE_FLOOR_MIN}–${CIRCLE_GATE_EVIDENCE_FLOOR_MAX}; default 2.`,
          },
          createElement(ControlNumber, {
            label: 'Circle-gate minimum grounded cashflow drivers',
            value: pendingSettings.circle_gate_min_drivers,
            min: CIRCLE_GATE_EVIDENCE_FLOOR_MIN,
            max: CIRCLE_GATE_EVIDENCE_FLOOR_MAX,
            onChange: (v) => update('circle_gate_min_drivers', v),
          }),
        ),

        createElement(
          ControlRow,
          {
            label: 'Circle-gate evidence floor: predictability breakers (advanced)',
            helper: `Minimum cite-verified predictability breakers each circle-gate judgment must ground — the gate must understand what could BREAK the cashflows, not just what drives them. Range ${CIRCLE_GATE_EVIDENCE_FLOOR_MIN}–${CIRCLE_GATE_EVIDENCE_FLOOR_MAX}; default 2.`,
          },
          createElement(ControlNumber, {
            label: 'Circle-gate minimum grounded predictability breakers',
            value: pendingSettings.circle_gate_min_breakers,
            min: CIRCLE_GATE_EVIDENCE_FLOOR_MIN,
            max: CIRCLE_GATE_EVIDENCE_FLOOR_MAX,
            onChange: (v) => update('circle_gate_min_breakers', v),
          }),
        ),
      ),
    ),

    // --- Monitoring & reviews section ---
    createElement(
      'section',
      { style: sectionStyle, 'aria-label': 'Monitoring and reviews settings' },
      createElement('p', { className: 'owl-section-accent' }, 'Monitoring & reviews'),
      createElement('h3', { className: 'owl-section-title', style: { margin: '0 0 0.4rem' } }, 'Watchlist and portfolio cadences'),
      createElement(
        'div',
        { style: controlGridStyle },

        createElement(
          ControlRow,
          {
            label: 'Watchlist monitoring',
            helper: 'The deterministic buy-window / staleness pass over watched names, and the tranche/concentration monitors over held ones. Observations only — never a trade.',
            workerNote: 'Cadence takes effect when the local worker runs.',
          },
          createElement(Toggle, {
            enabled: pendingSettings.watchlist_monitoring.enabled,
            onChange: (v) => update('watchlist_monitoring', { ...pendingSettings.watchlist_monitoring, enabled: v }),
          }),
          createElement(ControlSelect<AutomationCadenceWatchlist>, {
            label: 'Watchlist monitoring cadence',
            value: pendingSettings.watchlist_monitoring.cadence,
            options: [
              { value: 'off', label: 'Off' },
              { value: 'daily', label: 'Daily' },
              { value: 'weekly', label: 'Weekly' },
            ],
            onChange: (v) => update('watchlist_monitoring', { ...pendingSettings.watchlist_monitoring, cadence: v }),
          }),
        ),

        // REVIEW RETIRED + 10-K cadence (2026-07-14/15): this switch drives the quarterly grounded
        // check-in (re_review_check) — the task's cadence is fixed quarterly (the 10-Q rhythm), so no
        // decorative cadence select. The ANNUAL full re-analysis needs no cadence knob either: a
        // detected new 10-K raises the one-click re-run prompt on the boards.
        createElement(
          ControlRow,
          {
            label: 'Thesis check-in (vs new filings)',
            helper: 'The quarterly grounded check-in: diffs filings NEW since each decision against the recorded thesis (INTACT / WEAKENED / BROKEN). A BROKEN thesis on a held name escalates a full re-analysis draft; a detected new annual report raises the one-click full re-run prompt on the boards.',
            workerNote: 'Runs quarterly when the local worker runs (also on demand from any board row).',
          },
          createElement(Toggle, {
            enabled: pendingSettings.thesis_review.enabled,
            onChange: (v) => update('thesis_review', { ...pendingSettings.thesis_review, enabled: v }),
          }),
        ),

        createElement(
          ControlRow,
          {
            label: 'Market price refresh',
            helper: 'Frequent market-price poll for buy-zone monitoring of held and watched stocks.',
            workerNote: 'Cadence takes effect when the local worker runs.',
          },
          createElement(Toggle, {
            enabled: pendingSettings.price_refresh.enabled,
            onChange: (v) => update('price_refresh', { ...pendingSettings.price_refresh, enabled: v }),
          }),
          createElement(ControlSelect<AutomationCadencePriceRefresh>, {
            label: 'Market price refresh cadence',
            value: pendingSettings.price_refresh.cadence,
            options: [
              { value: 'off', label: 'Off' },
              { value: 'daily', label: 'Daily' },
              { value: 'weekly', label: 'Weekly' },
            ],
            onChange: (v) => update('price_refresh', { ...pendingSettings.price_refresh, cadence: v }),
          }),
        ),
      ),
    ),

    // --- Compliance section ---
    // SCALE-DOWN truth (2026-07-15): the purification LEDGER is gone — this section now presents the
    // one thing the legacy `purification` config key still does: supply the Shariah re-screen task's
    // cadence. Its on/off rides the Shariah screening toggle (the section below).
    createElement(
      'section',
      { style: sectionStyle, 'aria-label': 'Compliance settings' },
      createElement('p', { className: 'owl-section-accent' }, 'Compliance'),
      createElement('h3', { className: 'owl-section-title', style: { margin: '0 0 0.4rem' } }, 'Shariah re-screen'),
      createElement(
        'div',
        { style: controlGridStyle },

        createElement(
          ControlRow,
          {
            label: 'Shariah ratio re-screen',
            helper: 'Re-checks held and watched names against the AAOIFI financial ratios on this cadence. A breach starts the 90-day grace, then a DIVEST-REQUIRED draft — always human-decided. On/off rides the Shariah screening toggle in the section below.',
            workerNote: 'Cadence takes effect when the local worker runs.',
          },
          createElement(ControlSelect<AutomationCadencePurification>, {
            label: 'Shariah re-screen cadence',
            value: pendingSettings.purification.cadence,
            options: [
              { value: 'off', label: 'Off' },
              { value: 'quarterly', label: 'Quarterly' },
              { value: 'annual', label: 'Annual' },
            ],
            onChange: (v) => update('purification', { ...pendingSettings.purification, cadence: v }),
          }),
        ),
      ),
    ),

    // --- Save bar ---
    createElement(
      'div',
      { style: saveBarStyle },
      saveState === 'saved'
        ? createElement('span', { style: savedFeedbackStyle }, 'Saved')
        : null,
      saveState === 'error'
        ? createElement('span', { style: errorFeedbackStyle }, 'Save failed — please try again')
        : null,
      createElement(
        'button',
        {
          type: 'button',
          style: isDirty && !isSaving ? saveButtonStyle : saveButtonDisabledStyle,
          disabled: !isDirty || isSaving,
          onClick: handleSave,
        },
        isSaving ? 'Saving…' : 'Save settings',
      ),
    ),
  )
}
