'use client'

import { createElement, type CSSProperties, useCallback, useState } from 'react'

import type {
  AutomationCadenceDiscovery,
  AutomationCadencePriceRefresh,
  AutomationCadencePurification,
  AutomationCadenceReanalysis,
  AutomationCadenceThesisReview,
  AutomationCadenceWatchlist,
  AutomationSettings,
} from '@owlfolio/shared'

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
  background: 'linear-gradient(180deg, rgba(243, 223, 177, 0.06), rgba(243, 223, 177, 0.035))',
  border: '1px solid rgba(182, 201, 173, 0.11)',
  borderRadius: '0.9rem',
  boxShadow: '0 24px 80px rgba(0, 0, 0, 0.28), inset 0 1px 0 rgba(255, 255, 255, 0.04)',
  padding: 'clamp(1rem, 2vw, 1.35rem)',
  display: 'grid',
  gap: '0.9rem',
}

const pausedSectionStyle: CSSProperties = {
  ...sectionStyle,
  opacity: 0.45,
  pointerEvents: 'none' as const,
}

const sectionEyebrowStyle: CSSProperties = {
  color: 'var(--owl-color-accent-bright)',
  fontFamily: 'var(--owl-font-mono)',
  fontSize: '0.72rem',
  fontWeight: 600,
  letterSpacing: '0.08em',
  margin: '0 0 0.15rem',
  textTransform: 'uppercase',
}

const sectionTitleStyle: CSSProperties = {
  color: 'var(--owl-color-text)',
  fontSize: '1.2rem',
  fontWeight: 640,
  letterSpacing: '-0.03em',
  margin: '0 0 0.4rem',
}

const controlRowStyle: CSSProperties = {
  alignItems: 'start',
  background: 'rgba(255, 255, 255, 0.026)',
  border: '1px solid rgba(182, 201, 173, 0.11)',
  borderRadius: '0.85rem',
  display: 'grid',
  gap: '0.35rem',
  gridTemplateColumns: 'minmax(0, 1fr) auto',
  padding: '0.72rem',
}

const controlLabelStyle: CSSProperties = {
  color: 'var(--owl-color-text)',
  fontSize: '0.9rem',
  fontWeight: 650,
  letterSpacing: '-0.01em',
}

const controlHelperStyle: CSSProperties = {
  color: 'var(--owl-color-muted)',
  fontSize: '0.79rem',
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
  fontSize: '0.86rem',
  fontWeight: 650,
  padding: '0.48rem 0.75rem',
  cursor: 'pointer',
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
  color: '#fca5a5',
  fontSize: '0.86rem',
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
  fontSize: '0.86rem',
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
  fontSize: '0.76rem',
  fontWeight: 600,
  letterSpacing: '0.05em',
}

const errorFeedbackStyle: CSSProperties = {
  color: '#fca5a5',
  fontSize: '0.79rem',
}

const workerNoteStyle: CSSProperties = {
  color: 'var(--owl-color-quiet)',
  fontFamily: 'var(--owl-font-mono)',
  fontSize: '0.68rem',
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
        createElement('p', { style: sectionEyebrowStyle }, 'Pipeline control'),
        createElement('h2', { style: sectionTitleStyle }, 'Research engine'),
        createElement(
          'p',
          { style: controlHelperStyle },
          engineOn
            ? 'Research pipeline active — Owlfolio can discover, screen, and deep-dive candidate stocks.'
            : 'Research engine off — Owlfolio only manages your existing holdings.',
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
        'Research pipeline paused. Discovery, deep-dive, quick-screen, and reanalysis controls below are preserved but inactive while the engine is off.',
      ),

    // --- Research section ---
    createElement(
      'section',
      { style: engineOn ? sectionStyle : pausedSectionStyle, 'aria-label': 'Research pipeline settings', 'aria-disabled': !engineOn },
      createElement('p', { style: sectionEyebrowStyle }, 'Research'),
      createElement('h3', { style: sectionTitleStyle }, 'Pipeline behaviour'),
      createElement(
        'div',
        { style: controlGridStyle },

        createElement(
          ControlRow,
          {
            label: 'Quick-screen approval',
            helper: 'How to handle a passing quick screen before a deep dive is queued.',
          },
          createElement(ControlSelect<AutomationSettings['quick_screen_approval']>, {
            label: 'Quick-screen approval',
            value: pendingSettings.quick_screen_approval,
            options: [
              { value: 'review', label: 'Review before deep dive' },
              { value: 'automatic', label: 'Automatic — queue deep dive immediately' },
            ],
            onChange: (v) => update('quick_screen_approval', v),
          }),
        ),

        createElement(
          ControlRow,
          {
            label: 'Discovery',
            helper: 'Proactively scan the market universe for new candidate stocks.',
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
      ),
    ),

    // --- Monitoring & reviews section ---
    createElement(
      'section',
      { style: sectionStyle, 'aria-label': 'Monitoring and reviews settings' },
      createElement('p', { style: sectionEyebrowStyle }, 'Monitoring & reviews'),
      createElement('h3', { style: sectionTitleStyle }, 'Watchlist and portfolio cadences'),
      createElement(
        'div',
        { style: controlGridStyle },

        createElement(
          ControlRow,
          {
            label: 'Watchlist monitoring',
            helper: 'Periodic re-check of watchlist candidates for material news or Shariah status changes.',
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

        createElement(
          ControlRow,
          {
            label: 'Thesis-intact review',
            helper: 'Checks if the thesis still holds; can trigger a full re-deep-dive (escalation coming soon).',
            workerNote: 'Cadence takes effect when the local worker runs.',
          },
          createElement(Toggle, {
            enabled: pendingSettings.thesis_review.enabled,
            onChange: (v) => update('thesis_review', { ...pendingSettings.thesis_review, enabled: v }),
          }),
          createElement(ControlSelect<AutomationCadenceThesisReview>, {
            label: 'Thesis-intact review cadence',
            value: pendingSettings.thesis_review.cadence,
            options: [
              { value: 'off', label: 'Off' },
              { value: 'monthly', label: 'Monthly' },
              { value: 'quarterly', label: 'Quarterly' },
            ],
            onChange: (v) => update('thesis_review', { ...pendingSettings.thesis_review, cadence: v }),
          }),
        ),

        createElement(
          ControlRow,
          {
            label: 'Annual full reanalysis',
            helper: 'Full swarm deep dive on this cadence (or on demand).',
            workerNote: 'Cadence takes effect when the local worker runs.',
          },
          createElement(ControlSelect<AutomationCadenceReanalysis>, {
            label: 'Annual full reanalysis cadence',
            value: pendingSettings.reanalysis.cadence,
            options: [
              { value: 'off', label: 'Off' },
              { value: 'annual', label: 'Annual' },
            ],
            onChange: (v) => update('reanalysis', { cadence: v }),
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
    createElement(
      'section',
      { style: sectionStyle, 'aria-label': 'Compliance settings' },
      createElement('p', { style: sectionEyebrowStyle }, 'Compliance'),
      createElement('h3', { style: sectionTitleStyle }, 'Purification'),
      createElement(
        'div',
        { style: controlGridStyle },

        createElement(
          ControlRow,
          {
            label: 'Purification obligations',
            helper: 'Track and schedule purification obligation calculations. This records config only — purification amounts and payments remain explicit user-confirmed ledger events.',
            workerNote: 'Cadence takes effect when the local worker runs.',
          },
          createElement(Toggle, {
            enabled: pendingSettings.purification.enabled,
            onChange: (v) => update('purification', { ...pendingSettings.purification, enabled: v }),
          }),
          createElement(ControlSelect<AutomationCadencePurification>, {
            label: 'Purification cadence',
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
