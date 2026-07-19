'use client'

import { createElement, useEffect, useRef, useState, type ReactNode } from 'react'

import { chunk, shouldTranslateText, TRANSLATE_TARGETS, type ElementLike } from '../lib/pageTranslate'

// ---------------------------------------------------------------------------
// The shell "Translate" control (owner, 2026-07-19).
//
// Uses the BROWSER'S built-in Translator API (Chromium; on-device models, downloaded per language
// pair on first use) to translate the page's prose in place — no server, no cloud, view-only. The
// walker honors the app's `translate="no"` hardening, so ids/tickers/commands/env names/model ids
// stay verbatim exactly as they do under the browser's own page translate.
//
// Where the API is absent (Firefox/Safari — SSR too), the control renders the HINT instead: use the
// browser's page translation (Firefox's is fully on-device). Progressive enhancement, fail-visible:
// a failed pack download or translate run reports and falls back — never a half-broken page state
// without saying so.
//
// Honest limitations (deliberate): element ATTRIBUTES (placeholders, aria-labels, titles) are not
// translated — only text nodes; and a React re-render restores English until the observer re-runs.
// ---------------------------------------------------------------------------

type TranslatorInstance = { translate(text: string): Promise<string> }
type TranslatorStatic = { create(options: { sourceLanguage: string; targetLanguage: string }): Promise<TranslatorInstance> }

function translatorApi(): TranslatorStatic | undefined {
  return (globalThis as { Translator?: TranslatorStatic }).Translator
}

type Phase = 'init' | 'unsupported' | 'idle' | 'working' | 'active' | 'error'

const HINT_TEXT = 'Translate — use your browser’s page translation'
const HINT_TITLE = 'Chrome/Edge: right-click the page → Translate. Firefox: the translate icon in the address bar (runs fully on your device). '
  + 'The app marks ids, tickers, and commands so translators leave them intact.'

const controlStyle = {
  alignItems: 'center',
  display: 'inline-flex',
  gap: '0.35rem',
} as const

export function PageTranslator(): ReactNode {
  const [phase, setPhase] = useState<Phase>('init')
  const [target, setTarget] = useState('original')
  const [progress, setProgress] = useState<{ done: number; total: number } | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)

  const translatorRef = useRef<TranslatorInstance | undefined>(undefined)
  /** Original English per text node — the restore ledger for "Original". */
  const originalsRef = useRef(new Map<Text, string>())
  /** Our own output per node, so observer callbacks can tell our writes from real changes. */
  const translatedRef = useRef(new Map<Text, string>())
  const observerRef = useRef<MutationObserver | undefined>(undefined)
  const retranslateTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    setPhase(translatorApi() === undefined ? 'unsupported' : 'idle')
    return () => { deactivate() }
  }, [])

  function collectTextNodes(root: Node): Text[] {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    const nodes: Text[] = []
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      const text = node as Text
      if (shouldTranslateText(text.nodeValue, text.parentElement as ElementLike | null)) {
        nodes.push(text)
      }
    }
    return nodes
  }

  async function translateNodes(nodes: Text[]): Promise<void> {
    const translator = translatorRef.current
    if (translator === undefined) return
    for (const batch of chunk(nodes, 6)) {
      await Promise.all(batch.map(async (node) => {
        const source = node.nodeValue
        if (source === null) return
        // Skip nodes already carrying our output (observer echoes of our own writes).
        if (translatedRef.current.get(node) === source) return
        try {
          const out = await translator.translate(source)
          if (!originalsRef.current.has(node)) originalsRef.current.set(node, source)
          translatedRef.current.set(node, out)
          node.nodeValue = out
        } catch {
          // A single node failing is not a page failure — it stays English (visible, honest).
        }
        setProgress((p) => (p === undefined ? p : { done: Math.min(p.done + 1, p.total), total: p.total }))
      }))
    }
  }

  function startObserver(): void {
    // React re-renders and app-router navigations replace text nodes with fresh English — the
    // observer queues anything new/changed (that is not our own write) for re-translation.
    const observer = new MutationObserver((mutations) => {
      const pending = new Set<Text>()
      for (const mutation of mutations) {
        if (mutation.type === 'characterData' && mutation.target.nodeType === Node.TEXT_NODE) {
          const text = mutation.target as Text
          if (translatedRef.current.get(text) !== text.nodeValue) pending.add(text)
        }
        for (const added of mutation.addedNodes) {
          for (const text of collectTextNodes(added)) pending.add(text)
        }
      }
      if (pending.size === 0) return
      const nodes = [...pending].filter((text) => shouldTranslateText(text.nodeValue, text.parentElement as ElementLike | null))
      if (nodes.length === 0) return
      if (retranslateTimer.current !== undefined) clearTimeout(retranslateTimer.current)
      retranslateTimer.current = setTimeout(() => { void translateNodes(nodes) }, 150)
    })
    observer.observe(document.body, { characterData: true, childList: true, subtree: true })
    observerRef.current = observer
  }

  function deactivate(): void {
    observerRef.current?.disconnect()
    observerRef.current = undefined
    if (retranslateTimer.current !== undefined) clearTimeout(retranslateTimer.current)
    for (const [node, original] of originalsRef.current) {
      if (node.isConnected) node.nodeValue = original
    }
    originalsRef.current.clear()
    translatedRef.current.clear()
    translatorRef.current = undefined
    setProgress(undefined)
  }

  async function activate(languageId: string): Promise<void> {
    const api = translatorApi()
    if (api === undefined) return
    setPhase('working')
    setError(undefined)
    try {
      // create() downloads the on-device language pack on first use — the slow step.
      translatorRef.current = await api.create({ sourceLanguage: 'en', targetLanguage: languageId })
      const nodes = collectTextNodes(document.body)
      setProgress({ done: 0, total: nodes.length })
      await translateNodes(nodes)
      startObserver()
      setPhase('active')
    } catch (caught) {
      deactivate()
      setPhase('error')
      setError(caught instanceof Error ? caught.message : 'translation unavailable')
    }
  }

  function onSelect(nextTarget: string): void {
    setTarget(nextTarget)
    deactivate()
    if (nextTarget === 'original') {
      setPhase('idle')
      return
    }
    void activate(nextTarget)
  }

  // SSR + first client paint render the hint; the mounted effect upgrades to the picker when the
  // browser exposes the API. The control itself is translate="no" — its labels are already native.
  if (phase === 'init' || phase === 'unsupported') {
    return createElement(
      'span',
      { className: 'owl-shell-context-chip', 'data-testid': 'translate-hint', title: HINT_TITLE, translate: 'no' },
      createElement('span', { className: 'owl-shell-context-label' }, HINT_TEXT),
    )
  }

  return createElement(
    'span',
    { className: 'owl-shell-context-chip', style: controlStyle, 'data-testid': 'translate-control', translate: 'no', title: 'Translates this page on your device with the browser’s built-in models. View-only — the recorded English stays authoritative.' },
    createElement('span', { className: 'owl-shell-context-label' }, 'Translate'),
    createElement(
      'select',
      {
        'aria-label': 'Translate this page',
        className: 'owl-select owl-focusable',
        onChange: (event: Event) => onSelect((event.target as HTMLSelectElement).value),
        value: target,
        style: { fontSize: 'var(--owl-text-2xs)', padding: '0.1rem 0.3rem' },
      },
      createElement('option', { value: 'original' }, 'Original (English)'),
      ...TRANSLATE_TARGETS.map((entry) => createElement('option', { key: entry.id, value: entry.id }, entry.label)),
    ),
    phase === 'working' && progress !== undefined
      ? createElement('span', { className: 'owl-shell-context-label', 'data-testid': 'translate-progress' }, `${progress.done}/${progress.total}`)
      : null,
    phase === 'error'
      ? createElement('span', { className: 'owl-shell-context-label', style: { color: 'var(--owl-color-risk-bright)' }, title: HINT_TITLE }, error === undefined ? 'unavailable — use the browser’s translate' : `${error} — use the browser’s translate`)
      : null,
  )
}
